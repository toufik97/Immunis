import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { loadSchedulePack } from "../../src/infra/packs/loader";
import { createChild } from "../../src/infra/repos/children";
import { addLot, getLot } from "../../src/infra/repos/stock";
import { listDosesByChild } from "../../src/infra/repos/encounters";
import { listOverridesByChild } from "../../src/infra/repos/audit";
import { listPendingOutbox } from "../../src/infra/sync/sync";
import {
  canonicalProductId,
  toEngineHistory,
  toGatedEngineHistory,
} from "../../src/app/evaluate-child";
import { recordVisit, RecordGateError } from "../../src/app/record-visit";

const pack = loadSchedulePack("MA");

const dose = (productGroupId: string, administeredOn: string, extra = {}) => ({
  productGroupId,
  administeredOn,
  origin: "CENTRE" as const,
  overridden: false,
  recordedBy: "nurse1",
  ...extra,
});

describe("history seam (single DoseRecord → engine mapping)", () => {
  it("canonicalizes aliases and drops CAMPAIGN", () => {
    expect(canonicalProductId(pack, "VITA_100K")).toBe("VITA");
    expect(canonicalProductId(pack, "VITA_200K")).toBe("VITA");
    expect(canonicalProductId(pack, "VITA")).toBe("VITA");
    expect(canonicalProductId(pack, "NOPE")).toBe("NOPE");

    const history = toEngineHistory(
      [
        { ...dose("VITA_100K", "2026-03-01"), origin: "CENTRE" },
        { ...dose("PENTA", "2026-03-01"), origin: "EXTERNAL" },
        { ...dose("PENTA", "2026-03-01"), origin: "CAMPAIGN" },
      ],
      pack
    );
    expect(history).toEqual([
      { administeredOn: "2026-03-01", productGroupId: "VITA", overridden: false },
      { administeredOn: "2026-03-01", productGroupId: "PENTA", overridden: false },
    ]);
  });

  it("strips incoming override flags but keeps prior flags", () => {
    const history = toGatedEngineHistory(
      [{ ...dose("PENTA", "2026-03-01"), overridden: true }],
      [{ ...dose("VITA_100K", "2026-04-01"), overridden: true }],
      pack
    );
    expect(history).toEqual([
      { administeredOn: "2026-03-01", productGroupId: "PENTA", overridden: true },
      { administeredOn: "2026-04-01", productGroupId: "VITA", overridden: false },
    ]);
  });

  it("detects duplicates across aliases", () => {
    const db = openTestDb();
    const child = createChild(db, { familyName: "A", givenName: "A", birthDate: "2026-01-01" });
    const prior = [{ ...dose("VITA", "2026-03-01") }];
    expect(() =>
      recordVisit(db, pack, child.birthDate, prior, {
        childId: child.id,
        date: "2026-03-01",
        screening: "VACCINATE",
        doses: [{ ...dose("VITA_100K", "2026-03-01") }],
      })
    ).toThrow(/duplicate/i);
    db.close();
  });
});

describe("recordVisit atomic commit (gate + store + audit)", () => {
  it("rolls back everything when the lot is unusable", () => {
    const db = openTestDb();
    const child = createChild(db, { familyName: "A", givenName: "A", birthDate: "2026-01-01" });
    const bad = addLot(db, {
      productGroupId: "PENTA",
      lotNumber: "OLD",
      expiryDate: "2020-01-01",
      coldChainOk: true,
      qtyOnHand: 5,
    });
    expect(() =>
      recordVisit(
        db,
        pack,
        child.birthDate,
        [],
        {
          childId: child.id,
          date: "2026-03-01",
          screening: "VACCINATE",
          doses: [{ ...dose("PENTA", "2026-03-01"), lotId: bad.id }],
          nextAppointmentDate: "2026-04-01",
        },
        { today: "2026-10-09", nowIso: "2026-10-09T00:00:00.000Z" }
      )
    ).toThrow(/not usable/);
    expect(listDosesByChild(db, child.id)).toHaveLength(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM encounters").get()).toMatchObject({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM appointments").get()).toMatchObject({ n: 0 });
    expect(listPendingOutbox(db)).toHaveLength(0);
    expect(listOverridesByChild(db, child.id)).toHaveLength(0);
    expect(getLot(db, bad.id)?.qtyOnHand).toBe(5);
    db.close();
  });

  it("commits encounter + override with the injected timestamp", () => {
    const db = openTestDb();
    const child = createChild(db, { familyName: "A", givenName: "A", birthDate: "2026-09-01" });
    const penta = addLot(db, {
      productGroupId: "PENTA",
      lotNumber: "L1",
      expiryDate: "2027-12-01",
      coldChainOk: true,
      qtyOnHand: 5,
    });
    const nowIso = "2026-09-20T12:00:00.000Z";
    // Gate first: early PENTA without override is rejected, nothing stored.
    let gate: RecordGateError | null = null;
    try {
      recordVisit(
        db,
        pack,
        child.birthDate,
        [],
        {
          childId: child.id,
          date: "2026-09-20",
          screening: "VACCINATE",
          doses: [{ ...dose("PENTA", "2026-09-20"), lotId: penta.id }],
        },
        { today: "2026-10-09", nowIso }
      );
    } catch (e) {
      gate = e as RecordGateError;
    }
    expect(gate?.status).toBe(422);
    expect(listDosesByChild(db, child.id)).toHaveLength(0);

    const { encounter, waived } = recordVisit(
      db,
      pack,
      child.birthDate,
      [],
      {
        childId: child.id,
        date: "2026-09-20",
        screening: "VACCINATE",
        doses: [{ ...dose("PENTA", "2026-09-20"), lotId: penta.id, overridden: true }],
        overrideReason: "clinician approved",
      },
      { today: "2026-10-09", nowIso }
    );
    expect(encounter.id).toBeTruthy();
    expect(waived.length).toBeGreaterThan(0);
    const audit = listOverridesByChild(db, child.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].encounterId).toBe(encounter.id);
    expect(audit[0].createdAt).toBe(nowIso);
    const outbox = listPendingOutbox(db);
    expect(outbox).toHaveLength(1);
    db.close();
  });

  it("rejects non-VACCINATE screening with doses at the gate", () => {
    const db = openTestDb();
    const child = createChild(db, { familyName: "A", givenName: "A", birthDate: "2026-01-01" });
    expect(() =>
      recordVisit(
        db,
        pack,
        child.birthDate,
        [],
        {
          childId: child.id,
          date: "2026-03-01",
          screening: "DEFER",
          doses: [{ ...dose("PENTA", "2026-03-01") }],
        },
        { today: "2026-10-09" }
      )
    ).toThrow(RecordGateError);
    expect(listDosesByChild(db, child.id)).toHaveLength(0);
    db.close();
  });
});

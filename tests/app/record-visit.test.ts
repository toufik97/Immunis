import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { loadSchedulePack } from "../../src/infra/packs/loader";
import { createChild } from "../../src/infra/repos/children";
import { addLot } from "../../src/infra/repos/stock";
import { listDosesByChild } from "../../src/infra/repos/encounters";
import { listOverridesByChild } from "../../src/infra/repos/audit";
import { recordVisit, RecordGateError } from "../../src/app/record-visit";

const pack = loadSchedulePack("MA");

function setup(birthDate = "2026-01-01") {
  const db = openTestDb();
  const child = createChild(db, { familyName: "A", givenName: "A", birthDate });
  const lot = (product: string) =>
    addLot(db, { productGroupId: product, lotNumber: "L1", expiryDate: "2027-12-01", coldChainOk: true, qtyOnHand: 5 });
  return { db, child, lot };
}

const dose = (productGroupId: string, administeredOn: string, extra = {}) => ({
  productGroupId,
  administeredOn,
  origin: "CENTRE" as const,
  overridden: false,
  recordedBy: "nurse1",
  ...extra,
});

describe("record gate (engine cross-check)", () => {
  it("records a clinically valid dose", () => {
    const { db, child, lot } = setup();
    const penta = lot("PENTA");
    const { encounter } = recordVisit(db, pack, child.birthDate, [], {
      childId: child.id,
      date: "2026-03-01",
      screening: "VACCINATE",
      doses: [{ ...dose("PENTA", "2026-03-01"), lotId: penta.id }],
    });
    expect(encounter.id).toBeTruthy();
    expect(listDosesByChild(db, child.id)).toHaveLength(1);
    db.close();
  });

  it("rejects duplicate product+date within the payload and against history", () => {
    const { db, child, lot } = setup();
    const penta = lot("PENTA");
    const d = { ...dose("PENTA", "2026-03-01"), lotId: penta.id };
    expect(() =>
      recordVisit(db, pack, child.birthDate, [], {
        childId: child.id,
        date: "2026-03-01",
        screening: "VACCINATE",
        doses: [d, { ...d }],
      })
    ).toThrow(/duplicate/i);
    recordVisit(db, pack, child.birthDate, [], {
      childId: child.id,
      date: "2026-03-01",
      screening: "VACCINATE",
      doses: [d],
    });
    expect(() =>
      recordVisit(db, pack, child.birthDate, listDosesByChild(db, child.id), {
        childId: child.id,
        date: "2026-03-01",
        screening: "VACCINATE",
        doses: [{ ...dose("PENTA", "2026-03-01"), lotId: penta.id }],
      })
    ).toThrow(/duplicate/i);
    db.close();
  });

  it("blocks an overridable early dose until a justified override is given, then audits it", () => {
    const { db, child, lot } = setup("2026-09-01");
    const penta = lot("PENTA");
    const input = {
      childId: child.id,
      date: "2026-09-20",
      screening: "VACCINATE" as const,
      doses: [{ ...dose("PENTA", "2026-09-20"), lotId: penta.id }],
    };
    let gate: RecordGateError | null = null;
    try {
      recordVisit(db, pack, child.birthDate, [], input);
    } catch (e) {
      gate = e as RecordGateError;
    }
    expect(gate).toBeInstanceOf(RecordGateError);
    expect(gate?.status).toBe(422);
    expect(gate?.issues[0].code).toMatch(/TOO_EARLY/);
    expect(listDosesByChild(db, child.id)).toHaveLength(0);

    // Override without a reason is still rejected.
    expect(() =>
      recordVisit(db, pack, child.birthDate, [], {
        ...input,
        doses: [{ ...input.doses[0], overridden: true }],
      })
    ).toThrow(RecordGateError);

    // Override with a reason records and audits.
    recordVisit(db, pack, child.birthDate, [], {
      ...input,
      doses: [{ ...input.doses[0], overridden: true }],
      overrideReason: "session day fell 2 days before 6 weeks, clinician approved",
    });
    expect(listDosesByChild(db, child.id)).toHaveLength(1);
    const audit = listOverridesByChild(db, child.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].reason).toMatch(/clinician approved/);
    db.close();
  });

  it("hard-stops a too-late dose even with an override", () => {
    const { db, child, lot } = setup("2023-01-01");
    const rota = lot("ROTAVIRUS");
    expect(() =>
      recordVisit(db, pack, child.birthDate, [], {
        childId: child.id,
        date: "2026-10-09",
        screening: "VACCINATE",
        doses: [{ ...dose("ROTAVIRUS", "2026-10-09", { overridden: true, lotId: rota.id }) }],
        overrideReason: "nurse insists",
      })
    ).toThrow(/TOO_LATE/);
    expect(listDosesByChild(db, child.id)).toHaveLength(0);
    db.close();
  });

  it("records a transcribed EXTERNAL dose without engine interference", () => {
    const { db, child } = setup("2023-01-01");
    const { encounter } = recordVisit(db, pack, child.birthDate, [], {
      childId: child.id,
      date: "2026-10-09",
      screening: "VACCINATE",
      doses: [
        {
          productGroupId: "ROTAVIRUS",
          administeredOn: "2026-10-09",
          origin: "EXTERNAL",
          overridden: false,
          recordedBy: "nurse1",
        },
      ],
    });
    expect(encounter.id).toBeTruthy();
    db.close();
  });

  it("rejects a CENTRE dose with an unknown product", () => {
    const { db, child } = setup();
    expect(() =>
      recordVisit(db, pack, child.birthDate, [], {
        childId: child.id,
        date: "2026-03-01",
        screening: "VACCINATE",
        doses: [dose("NOPE", "2026-03-01")],
      })
    ).toThrow(/UNKNOWN_PRODUCT/);
    db.close();
  });
});

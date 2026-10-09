import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { createChild, allocateLocalId } from "../../src/infra/repos/children";
import { addLot } from "../../src/infra/repos/stock";
import { recordEncounter } from "../../src/infra/repos/encounters";
import { insertOverride } from "../../src/infra/repos/audit";
import { exportCentre, importCentre, listPendingOutbox } from "../../src/infra/sync/sync";

describe("sync and hardening", () => {
  it("exports a centre and re-imports it losslessly", () => {
    const src = openTestDb();
    const child = createChild(src, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    allocateLocalId(src, child.id, "CS01", "2026");
    const lot = addLot(src, {
      productGroupId: "PENTA",
      lotNumber: "L1",
      expiryDate: "2027-01-01",
      coldChainOk: true,
      qtyOnHand: 5,
    });
    recordEncounter(src, {
      childId: child.id,
      date: "2026-10-09",
      screening: "VACCINATE",
      doses: [
        {
          productGroupId: "PENTA",
          administeredOn: "2026-10-09",
          origin: "CENTRE",
          lotId: lot.id,
          overridden: false,
          recordedBy: "nurse1",
        },
      ],
      nextAppointmentDate: "2026-11-09",
    });
    insertOverride(src, {
      childId: child.id,
      author: "nurse1",
      what: "early dose",
      reason: "session constraint",
      createdAt: "2026-10-09T10:00:00",
    });

    const dump = exportCentre(src);
    expect(listPendingOutbox(src)).toHaveLength(1);
    src.close();

    const dst = openTestDb();
    const stats = importCentre(dst, dump);
    expect(stats.children).toBe(1);
    expect(stats.doses).toBe(1);
    const kids = dst.prepare("SELECT * FROM children").all() as unknown[];
    expect(kids).toHaveLength(1);
    const lots = dst.prepare("SELECT qty_on_hand AS q FROM lots").all() as { q: number }[];
    expect(lots[0].q).toBe(4);
    // Re-import is idempotent.
    importCentre(dst, dump);
    expect((dst.prepare("SELECT * FROM children").all() as unknown[])).toHaveLength(1);
    dst.close();
  });

  it("blocks audit mutation and invalid origins at the DB level", () => {
    const db = openTestDb();
    const child = createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    insertOverride(db, {
      childId: child.id,
      author: "nurse1",
      what: "w",
      reason: "r",
      createdAt: "2026-10-09T10:00:00",
    });
    expect(() => db.prepare("UPDATE overrides SET reason = 'x'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM overrides").run()).toThrow(/append-only/);
    expect(() =>
      db.prepare("INSERT INTO doses (id, encounter_id, child_id, product_group_id, administered_on, origin, recorded_by) VALUES ('x','y',?,'PENTA','2026-10-09','BOGUS','n')").run(child.id)
    ).toThrow();
    db.close();
  });
});

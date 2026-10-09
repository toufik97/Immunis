import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { createChild } from "../../src/infra/repos/children";
import { addLot, getLot } from "../../src/infra/repos/stock";
import { recordEncounter, listDosesByChild } from "../../src/infra/repos/encounters";
import { countCentreDosesByProduct } from "../../src/app/analytics";

function setup() {
  const db = openTestDb();
  const child = createChild(db, { familyName: "T", givenName: "T", birthDate: "2025-01-01" });
  const lot = addLot(db, {
    productGroupId: "PENTA",
    lotNumber: "L1",
    expiryDate: "2027-01-01",
    coldChainOk: true,
    qtyOnHand: 5,
  });
  return { db, child, lot };
}

describe("encounters", () => {
  it("records a CENTRE dose: consumes stock and creates an appointment", () => {
    const { db, child, lot } = setup();
    const enc = recordEncounter(db, {
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
    expect(enc.id).toBeTruthy();
    expect(getLot(db, lot.id)?.qtyOnHand).toBe(4);
    const doses = listDosesByChild(db, child.id);
    expect(doses).toHaveLength(1);
    db.close();
  });

  it("records an EXTERNAL dose without touching stock", () => {
    const { db, child, lot } = setup();
    recordEncounter(db, {
      childId: child.id,
      date: "2026-10-09",
      screening: "VACCINATE",
      doses: [
        {
          productGroupId: "PENTA",
          administeredOn: "2026-09-01",
          origin: "EXTERNAL",
          overridden: false,
          recordedBy: "nurse1",
        },
      ],
    });
    expect(getLot(db, lot.id)?.qtyOnHand).toBe(5);
    // Analytics count only CENTRE doses.
    expect(countCentreDosesByProduct(db)).toEqual({});
    db.close();
  });

  it("rejects a CENTRE dose without a lot or with an expired lot", () => {    const { db, child } = setup();
    expect(() =>
      recordEncounter(db, {
        childId: child.id,
        date: "2026-10-09",
        screening: "VACCINATE",
        doses: [
          {
            productGroupId: "PENTA",
            administeredOn: "2026-10-09",
            origin: "CENTRE",
            overridden: false,
            recordedBy: "nurse1",
          },
        ],
      })
    ).toThrow();
    const bad = addLot(db, {
      productGroupId: "PENTA",
      lotNumber: "OLD",
      expiryDate: "2020-01-01",
      coldChainOk: true,
      qtyOnHand: 5,
    });
    expect(() =>
      recordEncounter(db, {
        childId: child.id,
        date: "2026-10-09",
        screening: "VACCINATE",
        doses: [
          {
            productGroupId: "PENTA",
            administeredOn: "2026-10-09",
            origin: "CENTRE",
            lotId: bad.id,
            overridden: false,
            recordedBy: "nurse1",
          },
        ],
      })
    ).toThrow();
    expect(listDosesByChild(db, child.id)).toHaveLength(0);
    db.close();
  });

  it("rejects future visit dates and future dose dates, but keeps past history", () => {
    const { db, child, lot } = setup();
    const base = {
      childId: child.id,
      screening: "VACCINATE" as const,
      doses: [] as never[],
    };
    expect(() => recordEncounter(db, { ...base, date: "2999-01-01" })).toThrow(/future/);
    expect(() =>
      recordEncounter(db, {
        ...base,
        date: "2026-10-09",
        doses: [
          {
            productGroupId: "PENTA",
            administeredOn: "2999-01-01",
            origin: "CENTRE",
            lotId: lot.id,
            overridden: false,
            recordedBy: "nurse1",
          },
        ],
      })
    ).toThrow(/future/);
    expect(() =>
      recordEncounter(db, { ...base, date: "2026-10-09", nextAppointmentDate: "2020-01-01" })
    ).toThrow(/past/);
    // Past doses (history transcribed from the carnet) stay accepted.
    const enc = recordEncounter(db, {
      ...base,
      date: "2026-10-09",
      doses: [
        {
          productGroupId: "PENTA",
          administeredOn: "2026-09-01",
          origin: "EXTERNAL",
          overridden: false,
          recordedBy: "nurse1",
        },
      ],
    });
    expect(enc.id).toBeTruthy();
    db.close();
  });
});

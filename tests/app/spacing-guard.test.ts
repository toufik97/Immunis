import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { loadSchedulePack } from "../../src/infra/packs/loader";
import { createChild } from "../../src/infra/repos/children";
import { addLot } from "../../src/infra/repos/stock";
import { listDosesByChild } from "../../src/infra/repos/encounters";
import { recordVisit, RecordGateError } from "../../src/app/record-visit";
import { checkSpacing } from "../../src/app/spacing-guard";

const pack = loadSchedulePack("MA");

const dose = (productGroupId: string, administeredOn: string, origin: "CENTRE" | "EXTERNAL" = "CENTRE") => ({
  productGroupId,
  administeredOn,
  origin,
  overridden: false,
  recordedBy: "nurse1",
});

describe("spacing guard (saving-time rule-book check)", () => {
  it("flags PrimoVax too close to PENTA in history", () => {
    const issues = checkSpacing([dose("PENTA", "2026-03-01", "EXTERNAL")], [{ dose: dose("PCV_PRIMOVAX", "2026-03-10"), index: 0 }], pack);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("SPACING_VIOLATION");
    expect(issues[0].message).toContain("minimum 14 days");
  });

  it("passes at exactly 14 days and spares Prevenar and exempt pairs", () => {
    const prior = [dose("PENTA", "2026-03-01", "EXTERNAL")];
    expect(checkSpacing(prior, [{ dose: dose("PCV_PRIMOVAX", "2026-03-15"), index: 0 }], pack)).toHaveLength(0);
    expect(checkSpacing(prior, [{ dose: dose("PCV_PREVENAR", "2026-03-01"), index: 0 }], pack)).toHaveLength(0);
    expect(
      checkSpacing([dose("VPO", "2026-03-01", "EXTERNAL")], [{ dose: dose("ROTAVIRUS", "2026-03-01"), index: 0 }], pack)
    ).toHaveLength(0);
  });

  it("blames the move_on_tie product when both doses are new and same-day", () => {
    const issues = checkSpacing(
      [],
      [
        { dose: dose("PENTA", "2026-03-01"), index: 0 },
        { dose: dose("PCV_PRIMOVAX", "2026-03-01"), index: 1 },
      ],
      pack
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].doseIndex).toBe(1);
    expect(issues[0].productGroupId).toBe("PCV_PRIMOVAX");
  });

  it("blocks same-day PENTA + PrimoVax at recording until justified, then audits", () => {
    const db = openTestDb();
    const child = createChild(db, { familyName: "A", givenName: "A", birthDate: "2026-01-01", sex: "M" });
    const lot = (product: string) =>
      addLot(db, { productGroupId: product, lotNumber: "L1", expiryDate: "2027-12-01", coldChainOk: true, qtyOnHand: 5 });
    const penta = lot("PENTA");
    const pcv = lot("PCV_PRIMOVAX");
    recordVisit(db, pack, child.birthDate, [], {
      childId: child.id,
      date: "2026-03-01",
      screening: "VACCINATE",
      doses: [{ ...dose("PENTA", "2026-03-01"), lotId: penta.id }],
    });
    let gate: RecordGateError | null = null;
    try {
      recordVisit(db, pack, child.birthDate, listDosesByChild(db, child.id), {
        childId: child.id,
        date: "2026-03-01",
        screening: "VACCINATE",
        doses: [{ ...dose("PCV_PRIMOVAX", "2026-03-01"), lotId: pcv.id }],
      });
    } catch (e) {
      gate = e as RecordGateError;
    }
    expect(gate).toBeInstanceOf(RecordGateError);
    expect(gate?.status).toBe(422);
    expect(gate?.issues.map((i) => i.code)).toContain("SPACING_VIOLATION");
    // Justified override records.
    recordVisit(db, pack, child.birthDate, listDosesByChild(db, child.id), {
      childId: child.id,
      date: "2026-03-01",
      screening: "VACCINATE",
      doses: [{ ...dose("PCV_PRIMOVAX", "2026-03-01"), overridden: true, lotId: pcv.id }],
      overrideReason: "clinician decision, single trip family",
    });
    db.close();
  });
});

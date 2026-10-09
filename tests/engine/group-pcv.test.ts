import { describe, it, expect } from "vitest";
import { run, need, count, doses, rec } from "./helpers";
import { evaluatePatient } from "../../src/engine";
import { loadSchedulePack } from "../../src/infra/packs/loader";
import { parseDate } from "../../src/engine/duration";
import type { Patient, ImmunizationRecord } from "../../src/types";

// Same as helpers.run() but lets us pass an explicit availability policy / stock list.
function runAvail(
  birthDate: string,
  history: ImmunizationRecord[],
  evalDate: string,
  availability: { policy?: string; products?: string[] }
) {
  const pack = loadSchedulePack("MA");
  return evaluatePatient(
    { birthDate } as Patient,
    history,
    pack,
    parseDate(evalDate),
    { availability: availability as any }
  );
}

describe("Group PCV — coexistence, policies, both products (Stage 5)", () => {

  describe("PC-A: new starters by age band (TRANSITION default → PrimoVax)", () => {
    it("PC-A1: 3m new starter → TT schema, 3 primaries, PrimoVax planned", () => {
      const r = run("2026-01-01", [], "2026-04-01");
      const n = need(r, "PCV_PROGRAM");
      expect(n.status).toBe("NEEDS_PRIMARY");
      expect(n.dosesNeeded).toBe(3);
      expect(r.visitPlan.visits.some(v => v.products.includes("PCV_PRIMOVAX"))).toBe(true);
    });

    it("PC-A2: 8m new starter → TT schema, 2 primaries", () => {
      const r = run("2025-08-01", [], "2026-04-01");
      expect(need(r, "PCV_PROGRAM").dosesNeeded).toBe(2);
    });

    it("PC-A3: 15m new starter → TT schema, 2 primaries, no booster", () => {
      const r = run("2025-01-01", [], "2026-04-01");
      expect(need(r, "PCV_PROGRAM").dosesNeeded).toBe(2);
    });

    it("PC-A4: 39m new starter → TT schema, 1 primary only", () => {
      const r = run("2023-01-01", [], "2026-04-01");
      expect(need(r, "PCV_PROGRAM").dosesNeeded).toBe(1);
    });

    it("PC-A5: 75m (≥5y) → silent none, no PCV visits", () => {
      const r = run("2020-01-01", [], "2026-04-01");
      expect(need(r, "PCV_PROGRAM").status).toBe("NOT_NEEDED");
      expect(need(r, "PCV_PROGRAM").dosesNeeded).toBe(0);
      for (const v of r.visitPlan.visits) {
        expect(v.products).not.toContain("PCV_PRIMOVAX");
        expect(v.products).not.toContain("PCV_PREVENAR");
      }
    });
  });

  describe("PC-B: Prevenar continuity & switching", () => {
    it("PC-B1: 1 Prevenar + available → continue Prevenar, 1 primary left", () => {
      const r = runAvail(
        "2026-01-01",
        [rec("2026-03-01", "PCV_PREVENAR")],
        "2026-04-01",
        { policy: "TRANSITION" }
      );
      const n = need(r, "PCV_PROGRAM");
      expect(n.status).toBe("NEEDS_PRIMARY");
      expect(n.dosesNeeded).toBe(1);
      expect(r.visitPlan.visits.some(v => v.products.includes("PCV_PREVENAR"))).toBe(true);
    });

    it("PC-B2: 1 Prevenar + Prevenar out of stock → switch to PrimoVax, 2 left", () => {
      const r = runAvail(
        "2026-01-01",
        [rec("2026-03-01", "PCV_PREVENAR")],
        "2026-04-01",
        { policy: "STOCK_DRIVEN", products: ["PCV_PRIMOVAX"] }
      );
      const n = need(r, "PCV_PROGRAM");
      expect(n.status).toBe("NEEDS_PRIMARY");
      expect(n.dosesNeeded).toBe(2);
      expect(r.visitPlan.visits.some(v => v.products.includes("PCV_PRIMOVAX"))).toBe(true);
    });

    it("PC-B3: 2 Prevenar doses → primaries complete, booster due", () => {
      const r = runAvail(
        "2025-01-01",
        [
          rec("2025-03-01", "PCV_PREVENAR"),
          rec("2025-06-01", "PCV_PREVENAR")
        ],
        "2026-04-01",
        { policy: "TRANSITION" }
      );
      const n = need(r, "PCV_PROGRAM");
      expect(n.dosesNeeded).toBe(0);
      expect(n.status).toBe("NEEDS_BOOSTER");
    });
  });

  describe("PC-C: mixed history (C2 lock → 3 primaries)", () => {
    it("PC-C1: 1 Prevenar + 1 PrimoVax → TT schema, 1 primary left", () => {
      const r = runAvail(
        "2025-11-01",
        [
          rec("2026-01-01", "PCV_PREVENAR"),
          rec("2026-03-01", "PCV_PRIMOVAX")
        ],
        "2026-04-01",
        { policy: "TRANSITION" }
      );
      const n = need(r, "PCV_PROGRAM");
      expect(n.status).toBe("NEEDS_PRIMARY");
      expect(n.dosesNeeded).toBe(1);
    });
  });

  describe("PC-D: stock-driven policies pick different products", () => {
    it("PC-D1: stock = only Prevenar → new starter gets Prevenar schema (2 primaries)", () => {
      const r = runAvail(
        "2026-01-01", [], "2026-04-01",
        { policy: "STOCK_DRIVEN", products: ["PCV_PREVENAR"] }
      );
      expect(need(r, "PCV_PROGRAM").dosesNeeded).toBe(2);
      expect(r.visitPlan.visits.some(v => v.products.includes("PCV_PREVENAR"))).toBe(true);
    });

    it("PC-D2: stock = only PrimoVax → new starter gets TT schema (3 primaries)", () => {
      const r = runAvail(
        "2026-01-01", [], "2026-04-01",
        { policy: "STOCK_DRIVEN", products: ["PCV_PRIMOVAX"] }
      );
      expect(need(r, "PCV_PROGRAM").dosesNeeded).toBe(3);
      expect(r.visitPlan.visits.some(v => v.products.includes("PCV_PRIMOVAX"))).toBe(true);
    });
  });

  describe("PC-E: 15-day spacing offset (PrimoVax vs Penta)", () => {
    it("PC-E1: PrimoVax never shares a day with Penta, ≥15 days after", () => {
      const r = run("2026-01-01", [], "2026-04-01");
      const penta = r.visitPlan.visits.find(v => v.products.includes("PENTA"));
      const pcv = r.visitPlan.visits.find(v => v.products.includes("PCV_PRIMOVAX"));
      expect(penta).toBeDefined();
      expect(pcv).toBeDefined();
      expect(pcv!.date).not.toBe(penta!.date);
      const gap = Math.round(
        (parseDate(pcv!.date).getTime() - parseDate(penta!.date).getTime()) / 86400000
      );
      expect(gap).toBeGreaterThanOrEqual(15);
    });

    it("PC-E2: offset warning is emitted", () => {
      const r = run("2026-01-01", [], "2026-04-01");
      expect(r.visitPlan.warnings.join(" ")).toContain("PCV13TT_DTP_OFFSET_15D");
    });
  });

  describe("PC-F: validation & counting", () => {
    it("PC-F1: valid PrimoVax doses count correctly", () => {
      const r = runAvail(
        "2026-01-01",
        [
          rec("2026-03-01", "PCV_PRIMOVAX"),
          rec("2026-05-01", "PCV_PRIMOVAX")
        ],
        "2026-06-01",
        { policy: "TRANSITION" }
      );
      expect(count(r, "PCV_DOSES")).toBe(2);
    });

    it("PC-F2: dose 2 given 14 days after dose 1 → interval violation", () => {
      const r = runAvail(
        "2026-01-01",
        [
          rec("2026-03-01", "PCV_PRIMOVAX"),
          rec("2026-03-15", "PCV_PRIMOVAX")
        ],
        "2026-04-01",
        { policy: "TRANSITION" }
      );
      const dose2 = doses(r, "PCV_DOSES").find(d => d.doseNumber === 2);
      expect(dose2).toBeDefined();
      expect(dose2!.valid).toBe(false);
      expect(dose2!.reasons.join(" ")).toContain("INVALID_INTERVAL");
    });
  });
  describe("PC-G: 3-dose TT completion → 12-month booster (item 2)", () => {
    it("2/4/6-month PrimoVax evaluated at 9 months → NEEDS_BOOSTER, not COMPLETE", () => {
      const r = runAvail("2026-01-01", [
        rec("2026-03-15", "PCV_PRIMOVAX"),
        rec("2026-05-15", "PCV_PRIMOVAX"),
        rec("2026-07-15", "PCV_PRIMOVAX")
      ], "2026-10-01", { policy: "TRANSITION" });
      const n = need(r, "PCV_PROGRAM");
      expect(n.status).toBe("NEEDS_BOOSTER");
      expect(n.boosterSequence).toBe(1);
    });
  });
});
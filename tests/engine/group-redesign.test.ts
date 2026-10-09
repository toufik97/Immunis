import { describe, it, expect } from "vitest";
import { run, rec, count, need, doses } from "./helpers";

// Regression locks for the redesigned scheduling core
// (scheduleWithSpacing + chainLowerBound + post-spacing age limits).
const ROTA = "ROTAVIRUS";

describe("Group Z — redesign regression locks", () => {
  it("Z1 (item 4): 5m catch-up → 3 distinct PrimoVax visits, none merged away", () => {
    const r = run("2025-11-01", [], "2026-04-01");
    expect(need(r, "PCV_PROGRAM").dosesNeeded).toBe(3);
    const pcv = r.visitPlan.visits.filter(v => v.products.includes("PCV_PRIMOVAX"));
    expect(pcv.length).toBe(3);
    expect(new Set(pcv.map(v => v.date)).size).toBe(3);
    expect(r.visitPlan.warnings.join(" ")).not.toContain("DUPLICATE_DOSE_SAME_DAY");
  });

  it("Z2 (item 3): VPO0 recorded at birth → not re-planned as a birth dose", () => {
    const r = run("2026-04-01", [rec("2026-04-01", "VPO")], "2026-04-10");
    expect(doses(r, "POLIO_ORAL_DOSES")[0].doseNumber).toBe(0);
    expect(count(r, "POLIO_ORAL_DOSES")).toBe(0);
    const birthVpo = r.visitPlan.visits.filter(
      v => v.role.includes("birth_dose") && v.products.includes("VPO")
    );
    expect(birthVpo.length).toBe(0);
    expect(need(r, "VPO_PROGRAM").dosesNeeded).toBe(3);
  });

  it("Z3 (item 9a): 23m Rota starter + recent live dose → pushed past 24m, dropped", () => {
    const r = run("2024-04-15", [rec("2026-03-25", "RR")], "2026-04-01");
    expect(need(r, "ROTA_PROGRAM").dosesNeeded).toBe(3);
    const rota = r.visitPlan.visits.filter(v => v.products.includes(ROTA));
    expect(rota.length).toBe(0);
    const w = r.visitPlan.warnings.join(" ");
    expect(w).toContain("LIVE_SPACING_SHIFT");
    expect(w).toContain("AGE_LIMIT_PREVENTS_DOSE");
  });

  it("Z4 (item 8a): newborn TT starter, full projection → PCV booster_1 projected", () => {
    const r = run("2026-01-01", [], "2026-01-15", "full");
    const booster = r.visitPlan.visits.find(
      v => v.status === "PROJECTED" && v.role === "booster_1" && v.products.includes("PCV_PRIMOVAX")
    );
    expect(booster).toBeDefined();
  });
});
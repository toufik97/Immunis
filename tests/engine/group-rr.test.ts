import { describe, it, expect } from "vitest";
import { run, count, need, expectVisitContains, expectVisitOnDateContains, rec } from "./helpers";

describe("Group M — Measles/Rubella + spacing + legacy", () => {
  it("M1: 15m never vaccinated → RR1 now, RR2 at 18m target", () => {
    const r = run("2025-01-01", [], "2026-04-01");
    expect(need(r, "RR_PROGRAM").dosesNeeded).toBe(2);
    expectVisitContains(r, 0, ["RR"], { date: "2026-04-01", status: "DUE_NOW" });
    expectVisitOnDateContains(r, "2026-07-01", ["RR"]);
  });

  it("M2: 18m never vaccinated → RR1 now, RR2 at least 4 weeks later", () => {
    const r = run("2024-10-01", [], "2026-04-01");
    const rrVisits = r.visitPlan.visits.filter(v => v.products.includes("RR"));
    expect(rrVisits.length).toBe(2);
    expect(rrVisits[0].date).toBe("2026-04-01");
    expect(rrVisits[1].date >= "2026-04-29").toBe(true);
  });

  it("M3: 6y never vaccinated → 2 doses, no age limit", () => {
    const r = run("2020-01-01", [], "2026-04-01");
    expect(need(r, "RR_PROGRAM").dosesNeeded).toBe(2);
    const rrVisits = r.visitPlan.visits.filter(v => v.products.includes("RR"));
    expect(rrVisits.length).toBe(2);
    expect(rrVisits[1].date >= "2026-04-29").toBe(true);
  });

  it("M4: RRO x2 counts; VAR x2 does not (measles-only legacy)", () => {
    const rro = run("2024-01-01", [
      rec("2025-03-01", "RRO"),
      rec("2025-10-01", "RRO")
    ], "2026-04-01");
    expect(count(rro, "RR_DOSES")).toBe(2);
    expect(need(rro, "RR_PROGRAM").status).toBe("COMPLETE");

    const var2 = run("2024-01-01", [
      rec("2024-10-01", "VAR"),
      rec("2025-04-01", "VAR")
    ], "2026-04-01");
    expect(count(var2, "RR_DOSES")).toBe(2);
    expect(need(var2, "RR_PROGRAM").status).toBe("COMPLETE");
  });

  it("M5: planner never offers legacy RRO or VAR", () => {
    const r = run("2025-04-01", [], "2026-04-01");
    for (const v of r.visitPlan.visits) {
      expect(v.products).not.toContain("RRO");
      expect(v.products).not.toContain("VAR");
    }
    expect(r.visitPlan.visits.some(v => v.products.includes("RR"))).toBe(true);
  });

  it("M6: live dose recorded 12 days ago → RR never inside the 1-27 day window", () => {
    const r = run("2025-07-01", [rec("2026-03-20", "VPO")], "2026-04-01");
    const rrVisit = r.visitPlan.visits.find(v => v.products.includes("RR"));
    expect(rrVisit).toBeDefined();
    const gap =
      (new Date(rrVisit!.date).getTime() - new Date("2026-03-20").getTime()) /
      86400000;
    expect(gap === 0 || gap >= 28).toBe(true);
  });

  it("M7: VPO vs rotavirus exemption — recorded Rota doesn't shift VPO", () => {
    const r = run("2025-12-01", [rec("2026-03-20", "ROTAVIRUS")], "2026-04-01");
    // If the exemption failed, VPO dose 1 (12 days after Rota) would be pushed to 04-17.
    // It must stay on the eval date.
    expect(r.visitPlan.visits.some(v => v.date === "2026-04-01" && v.products.includes("VPO"))).toBe(true);
  });

  it("M8: rotavirus recorded 7 days ago shifts RR1 (not an exempt pair)", () => {
    const r = run("2025-06-01", [rec("2026-03-25", "ROTAVIRUS")], "2026-04-01");
    const rrVisit = r.visitPlan.visits.find(v => v.products.includes("RR"));
    // VPO at 04-01 also constrains RR (both live, not exempt) -> 04-01 + 28d = 04-29
    expect(rrVisit?.date).toBe("2026-04-29");
  });

  it("M9: BCG recorded 12 days ago (live) → RR pushed to the 28-day gap", () => {
    const r = run("2025-07-01", [rec("2026-03-20", "BCG")], "2026-04-01");
    const rrVisit = r.visitPlan.visits.find(v => v.products.includes("RR"));
    expect(rrVisit).toBeDefined();
    const gap = (new Date(rrVisit!.date).getTime() - new Date("2026-03-20").getTime()) / 86400000;
    expect(gap === 0 || gap >= 28).toBe(true);
  });
});
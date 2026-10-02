import { describe, it, expect } from "vitest";
import { run, need, expectVisitContains, rec } from "./helpers";

describe("Group N — birth doses (first 4 weeks window)", () => {
  it("N1: newborn → HB_MONO + VPO + BCG at birth visit; Penta carries HB from 2m", () => {
    const r = run("2026-04-01", [], "2026-04-01");
    expectVisitContains(r, 0, ["HB_MONO", "VPO", "BCG"], {
      date: "2026-04-01",
      status: "DUE_NOW"
    });
    expectVisitContains(r, 1, ["PENTA"], { date: "2026-06-01" });
    expect(r.visitPlan.visits[1].products).not.toContain("HB_MONO");
  });

  it("N2: 2-week-old → birth doses still planned", () => {
    const r = run("2026-03-01", [], "2026-03-15");
    expectVisitContains(r, 0, ["HB_MONO", "VPO", "BCG"], { date: "2026-03-15" });
  });

  it("N3: 6-week-old → window passed, no birth visit; Penta absorbs HB", () => {
    const r = run("2026-02-01", [], "2026-03-15");
    expect(r.visitPlan.visits[0].products).not.toContain("HB_MONO");
    expect(r.visitPlan.visits[0].products).not.toContain("VPO");
    expect(need(r, "HB_PROGRAM").dosesNeeded).toBe(3);
  });

  it("N4: HB_MONO recorded at birth → no second monovalent planned", () => {
    const r = run("2026-04-01", [rec("2026-04-01", "HB_MONO")], "2026-04-02");
    expect(need(r, "HB_PROGRAM").dosesNeeded).toBe(2);
    expect(
      r.visitPlan.visits.some(v => v.products.includes("HB_MONO"))
    ).toBe(false);
  });
});
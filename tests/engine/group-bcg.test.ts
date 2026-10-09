import { describe, it, expect } from "vitest";
import { run, count, need, expectVisitContains, rec } from "./helpers";

describe("Group BCG — Tuberculosis", () => {
  it("BCG1: newborn, no dose → BCG due now", () => {
    const r = run("2026-04-01", [], "2026-04-15");
    expect(need(r, "BCG_PROGRAM").dosesNeeded).toBe(1);
    expectVisitContains(r, 0, ["BCG"], { date: "2026-04-15", status: "DUE_NOW" });
  });

  it("BCG2: 6m never vaccinated → 1 dose now", () => {
    const r = run("2025-10-01", [], "2026-04-01");
    expect(need(r, "BCG_PROGRAM").dosesNeeded).toBe(1);
    expectVisitContains(r, 0, ["BCG"], { date: "2026-04-01" });
  });

  it("BCG3: 3y never vaccinated → 1 dose now (same product, 0.1ml shown by UI)", () => {
    const r = run("2023-04-01", [], "2026-04-01");
    expect(need(r, "BCG_PROGRAM").dosesNeeded).toBe(1);
    expectVisitContains(r, 0, ["BCG"], { date: "2026-04-01" });
  });

  it("BCG4: 7y never vaccinated → silent none", () => {
    const r = run("2019-04-01", [], "2026-04-01");
    expect(need(r, "BCG_PROGRAM").status).toBe("NOT_NEEDED");
    expect(need(r, "BCG_PROGRAM").warnings).toEqual([]);
    expect(
      r.visitPlan.visits.some(v => v.products.includes("BCG"))
    ).toBe(false);
  });

  it("BCG5: dose recorded at 2y counts as valid → COMPLETE", () => {
    const r = run("2023-04-01", [rec("2025-04-01", "BCG")], "2026-04-01");
    expect(count(r, "BCG_DOSES")).toBe(1);
    expect(need(r, "BCG_PROGRAM").status).toBe("COMPLETE");
  });

  it("BCG6: second recorded BCG is a harmless extra", () => {
    const r = run("2023-04-01", [
      rec("2023-05-01", "BCG"),
      rec("2025-05-01", "BCG")
    ], "2026-04-01");
    expect(count(r, "BCG_DOSES")).toBe(2);
    expect(need(r, "BCG_PROGRAM").status).toBe("COMPLETE");
  });
});
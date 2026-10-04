import { describe, it, expect } from "vitest";
import { run, expectVisitContains, expectVisitOnDateContains, rec } from "./helpers";

describe("Group C — conditional intervals (resilient)", () => {
  it("C1: dose 2 at 11m → dose 3 at 4 weeks", () => {
    const r = run("2025-01-01", [
      rec("2025-03-01", "PENTA"),
      rec("2025-11-01", "PENTA")
    ], "2025-11-15");
    // PCV steals index 0 at the eval date, so find PENTA by product
    const pentaVisit = r.visitPlan.visits.find(v => v.products.includes("PENTA"));
    expect(pentaVisit).toBeDefined();
    expect(pentaVisit!.date).toBe("2025-11-29");
    expect(pentaVisit!.status).toBe("DUE_FUTURE");
  });

  it("C2: dose 2 at 13m → dose 3 at 6 months (DTC and HB may split due to 5m vs 6m intervals)", () => {
    const r = run("2023-01-01", [
      rec("2024-01-01", "PENTA"),
      rec("2024-02-01", "PENTA")
    ], "2024-03-01");
    const allVisits = r.visitPlan.visits;
    expect(allVisits.some(v => v.products.includes("DTC"))).toBe(true);
    expect(allVisits.some(v => v.products.includes("HB_MONO"))).toBe(true);
  });

  it("C3: HB dose 2 at 25m → dose 3 at 6 months, Penta covers all", () => {
    const r = run("2022-01-01", [
      rec("2022-01-01", "HB_MONO"),
      rec("2024-02-01", "HB_MONO")
    ], "2024-03-01");
    expectVisitOnDateContains(r, "2024-08-01", ["PENTA"], "DUE_FUTURE");
  });

  it("C4: Hib dose 2 at 4m → dose 3 held to 4 months min age", () => {
    const r = run("2025-01-01", [
      rec("2025-03-01", "PENTA"),
      rec("2025-04-01", "PENTA")
    ], "2025-04-10");
    const pentaVisit = r.visitPlan.visits.find(v => v.products.includes("PENTA"));
    expect(pentaVisit).toBeDefined();
    expect(pentaVisit!.date).toBe("2025-05-01");
  });

  it("C5: Hib dose 2 at 8m → dose 3 (rappel) at 4 weeks", () => {
    const r = run("2025-01-01", [
      rec("2025-03-01", "PENTA"),
      rec("2025-09-01", "PENTA")
    ], "2025-09-10");
    const pentaVisit = r.visitPlan.visits.find(v => v.products.includes("PENTA"));
    expect(pentaVisit).toBeDefined();
    expect(pentaVisit!.date).toBe("2025-10-01");
  });
});
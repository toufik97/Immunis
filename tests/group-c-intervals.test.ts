import { describe, it, expect } from "vitest";
import { run, expectVisitContains, expectVisitOnDateContains, rec } from "./helpers";

describe("Group C — conditional intervals (resilient)", () => {
  it("C1: dose 2 at 10m → dose 3 at 4 weeks (PCV not due, so no spacing involved)", () => {
    const r = run("2025-01-01", [
      rec("2025-03-01", "PENTA"),
      rec("2025-11-01", "PENTA"),
      rec("2025-03-20", "PCV_PRIMOVAX"),
      rec("2025-09-20", "PCV_PRIMOVAX")
    ], "2025-11-15");
    const penta = r.visitPlan.visits.find(v => v.products.includes("PENTA"));
    expect(penta!.date).toBe("2025-11-29");
    expect(penta!.status).toBe("DUE_FUTURE");
  });

  it("C1b: same child, PrimoVax due now → PrimoVax first, Penta 15 days after it", () => {
    const r = run("2025-01-01", [
      rec("2025-03-01", "PENTA"),
      rec("2025-11-01", "PENTA")
    ], "2025-11-15");
    const primo = r.visitPlan.visits.find(v => v.products.includes("PCV_PRIMOVAX"));
    const penta = r.visitPlan.visits.find(v => v.products.includes("PENTA"));
    expect(primo!.date).toBe("2025-11-16"); // 15 days after the Penta given 2025-11-01
    expect(penta!.date).toBe("2025-12-01"); // 15 days after the PrimoVax
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
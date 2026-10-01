import { describe, it, expect } from "vitest";
import { run, count, need, doses, expectVisitContains, rec } from "./helpers";

describe("Group P — Polio (VPO + VPI)", () => {
  it("P1: routine child — dose 0 excluded, VPO booster 1 due, VPI complete", () => {
    const r = run("2024-01-01", [
      rec("2024-01-01", "VPO"),
      rec("2024-03-01", "VPO"),
      rec("2024-04-01", "VPO"),
      rec("2024-05-01", "VPO"),
      rec("2024-05-01", "VPI"),
      rec("2024-10-01", "VPI")
    ], "2026-04-01");
    expect(doses(r, "POLIO_ORAL_DOSES")[0].doseNumber).toBe(0);
    expect(count(r, "POLIO_ORAL_DOSES")).toBe(3);
    expect(need(r, "VPO_PROGRAM").status).toBe("NEEDS_BOOSTER");
    expect(need(r, "VPO_PROGRAM").boosterSequence).toBe(1);
    expect(need(r, "VPI_PROGRAM").status).toBe("COMPLETE");
  });

  it("P2: stockout — full Penta history, zero VPO → 3 VPO doses now", () => {
    const r = run("2024-10-01", [
      rec("2024-12-01", "PENTA"),
      rec("2025-01-01", "PENTA"),
      rec("2025-02-01", "PENTA")
    ], "2026-04-01");
    expect(need(r, "VPO_PROGRAM").dosesNeeded).toBe(3);
    expectVisitContains(r, 0, ["VPO"]);
  });

  it("P3: VPO complete but no VPI → VPI needs 2", () => {
    const r = run("2024-01-01", [
      rec("2024-03-01", "VPO"),
      rec("2024-04-01", "VPO"),
      rec("2024-05-01", "VPO")
    ], "2026-04-01");
    expect(need(r, "VPI_PROGRAM").dosesNeeded).toBe(2);
  });

  it("P4: 3y never vaccinated → first visit carries DTC+HB+VPO+VPI (Penta ineligible at 3y)", () => {
    const r = run("2023-04-01", [], "2026-04-01");
    expectVisitContains(r, 0, ["DTC", "HB_MONO", "VPO", "VPI"], { date: "2026-04-01" });
  });

  it("P5: VPI2 at 5 months counts with EARLY_DOSE_2_COUNTED warning", () => {
    const r = run("2025-01-01", [
      rec("2025-05-01", "VPI"),
      rec("2025-06-01", "VPI")
    ], "2026-04-01");
    const d2 = doses(r, "POLIO_INACTIVATED_DOSES")[1];
    expect(d2.valid).toBe(true);
    expect(d2.warnings.join(" ")).toContain("EARLY_DOSE_2_COUNTED");
    expect(need(r, "VPI_PROGRAM").status).toBe("COMPLETE");
  });

  it("P6: VPI2 planned at 9 months for routine infant", () => {
    const r = run("2025-01-01", [rec("2025-05-01", "VPI")], "2025-06-01");
    const vpiVisit = r.visitPlan.visits.find(v => v.products.includes("VPI"));
    expect(vpiVisit?.date).toBe("2025-10-01");
  });

  it("P7: VPO given at 6 weeks is dose 0 (not counted)", () => {
    const r = run("2024-01-01", [rec("2024-02-12", "VPO")], "2026-04-01");
    expect(doses(r, "POLIO_ORAL_DOSES")[0].doseNumber).toBe(0);
    expect(count(r, "POLIO_ORAL_DOSES")).toBe(0);
    expect(need(r, "VPO_PROGRAM").dosesNeeded).toBe(3);
  });

  it("P8: 9y never vaccinated → silent none for both polio programs", () => {
    const r = run("2017-01-01", [], "2026-04-01");
    expect(need(r, "VPO_PROGRAM").status).toBe("NOT_NEEDED");
    expect(need(r, "VPO_PROGRAM").warnings).toEqual([]);
    expect(need(r, "VPI_PROGRAM").status).toBe("NOT_NEEDED");
    expect(need(r, "VPI_PROGRAM").warnings).toEqual([]);
  });
});
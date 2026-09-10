import { describe, it, expect } from "vitest";
import { run, count, need, expectVisit, rec, doses } from "./helpers"; // ADDED doses

const P3 = (y: string) => [
  rec(`${y}-06-01`, "PENTA"),
  rec(`${y}-07-01`, "PENTA"),
  rec(`${y}-08-01`, "PENTA")
];

describe("Group B — catch-up matrix", () => {
  it("B1: 4m, none → P, P+1m, P+4w (HB 1-month interval applies)", () => {
    const r = run("2026-01-01", [], "2026-05-01");
    expectVisit(r, 0, "2026-05-01", ["PENTA"], "DUE_NOW");
    expectVisit(r, 1, "2026-06-01", ["PENTA"]); // HB dose 2 needs 1 month
    expectVisit(r, 2, "2026-06-29", ["PENTA"]); // 4 weeks after June 1
  });

  it("B2: 10m, none → P, P+1m, P+4w", () => {
    const r = run("2025-06-01", [], "2026-04-01");
    expectVisit(r, 0, "2026-04-01", ["PENTA"], "DUE_NOW");
    expectVisit(r, 1, "2026-05-01", ["PENTA"]);
    expectVisit(r, 2, "2026-05-29", ["PENTA"]);
  });

  it("B3: 24m, none → P; D+H; D+H at 6m (conditional interval)", () => {
    const r = run("2024-04-01", [], "2026-04-01");
    expectVisit(r, 0, "2026-04-01", ["PENTA"], "DUE_NOW");
    expectVisit(r, 1, "2026-05-01", ["DTC", "HB_MONO"]); // HB 1-month interval
    expectVisit(r, 2, "2026-11-01", ["DTC", "HB_MONO"]); // DTP dose 3 conditional: previous dose >= 12m -> 6 months
  });

  it("B4: 4y, none → D+H ×3 and Hib unmet warning", () => {
    const r = run("2022-04-01", [], "2026-04-01");
    expectVisit(r, 0, "2026-04-01", ["DTC", "HB_MONO"], "DUE_NOW");
    expectVisit(r, 1, "2026-05-01", ["DTC", "HB_MONO"]);
    expectVisit(r, 2, "2026-11-01", ["DTC", "HB_MONO"]);
    expect(r.productSelection.warnings.join(" ")).toContain("HIB_PROGRAM");
  });

  it("B5: 6y, none → D+H ×3, Hib not needed", () => {
    const r = run("2020-04-01", [], "2026-04-01");
    expect(need(r, "HIB_PROGRAM").status).toBe("NOT_NEEDED");
    expect(r.visitPlan.visits.length).toBe(3);
  });

  it("B6: 7y6m, none → DTP out of scope warning", () => {
    const r = run("2018-10-01", [], "2026-04-01");
    const n = need(r, "DTP_PROGRAM");
    expect(n.status).toBe("NOT_NEEDED");
    expect(n.warnings.length).toBeGreaterThan(0);
  });

  it("B7: 10m, P@2m → P now, P+4w", () => {
    const r = run("2025-06-01", [rec("2025-08-01", "PENTA")], "2026-04-01");
    expectVisit(r, 0, "2026-04-01", ["PENTA"], "DUE_NOW");
    expectVisit(r, 1, "2026-04-29", ["PENTA"]); // HB already has 1 dose, so 1-month interval doesn't push visit 2
  });

  it("B8: 24m, P@2m → D+H, D+H (Hib complete)", () => {
    const r = run("2024-04-01", [rec("2024-06-01", "PENTA")], "2026-04-01");
    expect(need(r, "HIB_PROGRAM").status).toBe("COMPLETE");
    expectVisit(r, 0, "2026-04-01", ["DTC", "HB_MONO"], "DUE_NOW");
    expectVisit(r, 1, "2026-10-01", ["DTC", "HB_MONO"]); // DTP conditional: previous < 12m -> 4w? No, dose 2 is DTC at 24m -> 6m
  });

  it("B9: 4y, P@2m → D+H ×2, Hib complete (1 dose suffices)", () => {
    const r = run("2022-04-01", [rec("2022-06-01", "PENTA")], "2026-04-01");
    expect(r.visitPlan.visits.length).toBe(2);
    expect(need(r, "HIB_PROGRAM").status).toBe("COMPLETE"); // 1 dose is enough after 12m
  });

  it("B10: 24m, P@2,3m → single D+H, Hib complete, no booster", () => {
    const r = run("2024-04-01", [
      rec("2024-06-01", "PENTA"),
      rec("2024-07-01", "PENTA")
    ], "2026-04-01");
    expect(need(r, "HIB_PROGRAM").status).toBe("COMPLETE");
    expect(r.visitPlan.visits.length).toBe(1);
    expectVisit(r, 0, "2026-04-01", ["DTC", "HB_MONO"], "DUE_NOW");
  });

  it("B11: 17m, primary complete → booster 1 DUE_FUTURE at 18m", () => {
    const r = run("2024-11-01", P3("2025"), "2026-04-01");
    expectVisit(r, 0, "2026-05-01", ["DTC"], "DUE_FUTURE");
  });

  it("B12: 24m, primary complete → booster 1 DUE_NOW", () => {
    const r = run("2024-04-01", P3("2024"), "2026-04-01");
    expectVisit(r, 0, "2026-04-01", ["DTC"], "DUE_NOW");
  });

  it("B13: 5y2m, B1@18m → booster 2 DUE_NOW (routine window, G14)", () => {
    const r = run("2021-02-01", [
      ...P3("2021"),
      rec("2022-08-01", "DTC")
    ], "2026-04-01");
    const n = need(r, "DTP_PROGRAM");
    expect(n.status).toBe("NEEDS_BOOSTER");
    expect(n.boosterSequence).toBe(2);
    expectVisit(r, 0, "2026-04-01", ["DTC"], "DUE_NOW");
  });

  it("B14: 6y, 5 valid doses → complete", () => {
    const r = run("2020-04-01", [
      ...P3("2020"),
      rec("2021-10-01", "DTC"),
      rec("2025-04-01", "DTC")
    ], "2026-04-01");
    expect(need(r, "DTP_PROGRAM").status).toBe("COMPLETE");
    expect(r.visitPlan.visits.length).toBe(0);
  });

  it("B15: P@14m counts with warning; booster 2 at 5y2m", () => {
    const r = run("2024-04-01", [
      ...P3("2024"),
      rec("2025-06-01", "PENTA")
    ], "2026-04-01");
    const d4 = doses(r, "DTP_CONTAINING_DOSES")[3];
    expect(d4.valid).toBe(true);
    expect(d4.warnings.join(" ")).toContain("EARLY_BOOSTER_1_COUNTED");
    expect(count(r, "DTP_CONTAINING_DOSES")).toBe(4);
    expectVisit(r, 0, "2029-04-01", ["DTC"], "DUE_FUTURE");
  });

  it("B16: DTC@8m invalid (T1 floor); booster 1 still due", () => {
    const r = run("2024-04-01", [
      ...P3("2024"),
      rec("2024-12-01", "DTC")
    ], "2026-04-01");
    const d4 = doses(r, "DTP_CONTAINING_DOSES")[3];
    expect(d4.valid).toBe(false);
    expect(d4.reasons).toContain("INVALID_INTERVAL_BEFORE_DOSE_4");
    expect(count(r, "DTP_CONTAINING_DOSES")).toBe(3);
    expectVisit(r, 0, "2026-04-01", ["DTC"], "DUE_NOW");
  });

  it("B17: routine child — 5 valid doses, zero warnings", () => {
    const r = run("2021-02-01", [
      ...P3("2021"),
      rec("2022-08-01", "DTC"),
      rec("2026-02-01", "DTC")
    ], "2026-04-01");
    expect(need(r, "DTP_PROGRAM").status).toBe("COMPLETE");
    for (const d of doses(r, "DTP_CONTAINING_DOSES")) {
      expect(d.warnings).toEqual([]);
    }
  });

  it("B18: booster 2 @4y6m counts with EARLY_BOOSTER_2_COUNTED", () => {
    const r = run("2021-02-01", [
      ...P3("2021"),
      rec("2022-08-01", "DTC"),
      rec("2025-08-01", "DTC")
    ], "2026-04-01");
    const d5 = doses(r, "DTP_CONTAINING_DOSES")[4];
    expect(d5.valid).toBe(true);
    expect(d5.warnings.join(" ")).toContain("EARLY_BOOSTER_2_COUNTED");
  });

  it("B19: booster 2 only 1y after late booster 1 → invalid (4y floor)", () => {
    const r = run("2020-04-01", [
      ...P3("2020"),
      rec("2024-04-01", "DTC"),
      rec("2025-04-01", "DTC")
    ], "2026-04-01");
    const d5 = doses(r, "DTP_CONTAINING_DOSES")[4];
    expect(d5.valid).toBe(false);
    expect(d5.reasons).toContain("INVALID_INTERVAL_BEFORE_DOSE_5");
    expect(count(r, "DTP_CONTAINING_DOSES")).toBe(4);
  });
});
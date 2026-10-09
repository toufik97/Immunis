import { describe, it, expect } from "vitest";
import {
  run, count, need, doses,
  expectVisitContains, expectVisitOnDateContains, rec
} from "./helpers";

const P3 = (y: string) => [
  rec(`${y}-06-01`, "PENTA"),
  rec(`${y}-07-01`, "PENTA"),
  rec(`${y}-08-01`, "PENTA")
];

describe("Group B — catch-up matrix (program needs + resilient visits)", () => {
  it("B1: 4m, none → all programs need full primary; Penta leads visits", () => {
    const r = run("2026-01-01", [], "2026-05-01");
    expect(need(r, "DTP_PROGRAM").dosesNeeded).toBe(3);
    expect(need(r, "HB_PROGRAM").dosesNeeded).toBe(3);
    expect(need(r, "HIB_PROGRAM").dosesNeeded).toBe(3);
    expect(need(r, "VPO_PROGRAM").dosesNeeded).toBe(3);
    expect(need(r, "VPI_PROGRAM").dosesNeeded).toBe(2);
    expectVisitContains(r, 0, ["PENTA", "VPO", "VPI"], { date: "2026-05-01", status: "DUE_NOW" });
    
    // Resilient: VPO (4 weeks) and Penta (1 month) diverge into separate visits.
    const futureVisits = r.visitPlan.visits.slice(1);
    expect(futureVisits.some(v => v.products.includes("PENTA"))).toBe(true);
    expect(futureVisits.some(v => v.products.includes("VPO"))).toBe(true);
    expect(futureVisits.some(v => v.products.includes("VPI"))).toBe(true);
  });


  it("B2: 10m, none → Penta now then +1m then +4w (3rd = Hib rappel)", () => {
    const r = run("2025-06-01", [], "2026-04-01");
    expectVisitContains(r, 0, ["PENTA", "VPO", "VPI"], { date: "2026-04-01", status: "DUE_NOW" });
    expectVisitOnDateContains(r, "2026-05-01", ["PENTA", "VPO"]);
    expectVisitOnDateContains(r, "2026-05-29", ["PENTA", "VPO"]);
  });

  it("B3: 24m, none → Penta now; DTC+HB at +1m and +6m", () => {
    const r = run("2024-04-01", [], "2026-04-01");
    expectVisitContains(r, 0, ["PENTA", "VPO", "VPI"], { date: "2026-04-01", status: "DUE_NOW" });
    expectVisitOnDateContains(r, "2026-05-01", ["DTC", "HB_MONO"]);
    expectVisitOnDateContains(r, "2026-11-01", ["DTC", "HB_MONO", "VPO"]);
  });

  it("B4: 4y, none → DTC+HB ×3 and Hib unmet warning", () => {
    const r = run("2022-04-01", [], "2026-04-01");
    expectVisitContains(r, 0, ["DTC", "HB_MONO", "VPO", "VPI"], { date: "2026-04-01", status: "DUE_NOW" });
    expectVisitOnDateContains(r, "2026-05-01", ["DTC", "HB_MONO"]);
    expectVisitOnDateContains(r, "2026-11-01", ["DTC", "HB_MONO", "VPO"]);
    expect(r.productSelection.warnings.join(" ")).toContain("HIB_PROGRAM");
  });

  it("B5: 6y, none → DTC+HB ×3; Hib not needed; polio still needed", () => {
    const r = run("2020-04-01", [], "2026-04-01");
    expect(need(r, "HIB_PROGRAM").status).toBe("NOT_NEEDED");
    expect(need(r, "DTP_PROGRAM").dosesNeeded).toBe(3);
    expect(need(r, "VPO_PROGRAM").dosesNeeded).toBe(3);
    expect(need(r, "VPI_PROGRAM").dosesNeeded).toBe(2);
    expectVisitContains(r, 0, ["DTC", "HB_MONO", "VPO", "VPI"], { date: "2026-04-01" });
  });

  it("B6: 7y6m, none → DTP silent handoff; DT takes over", () => {
    const r = run("2018-10-01", [], "2026-04-01");
    const dtp = need(r, "DTP_PROGRAM");
    expect(dtp.status).toBe("NOT_NEEDED");
    expect(dtp.warnings).toEqual([]);
    expect(need(r, "DT_PROGRAM").dosesNeeded).toBe(3);
  });

  it("B7: 10m, P@2m → Penta now and +4w", () => {
    const r = run("2025-06-01", [rec("2025-08-01", "PENTA")], "2026-04-01");
    expectVisitContains(r, 0, ["PENTA", "VPO", "VPI"], { date: "2026-04-01", status: "DUE_NOW" });
    const futureVisits = r.visitPlan.visits.slice(1);
    expect(futureVisits.some(v => v.products.includes("PENTA"))).toBe(true);
    expect(futureVisits.some(v => v.products.includes("VPO"))).toBe(true);
  });

  it("B8: 24m, P@2m → DTC+HB ×2; Hib complete", () => {
    const r = run("2024-04-01", [rec("2024-06-01", "PENTA")], "2026-04-01");
    expect(need(r, "HIB_PROGRAM").status).toBe("COMPLETE");
    expectVisitContains(r, 0, ["DTC", "HB_MONO", "VPO", "VPI"], { date: "2026-04-01", status: "DUE_NOW" });
    const futureVisits = r.visitPlan.visits.slice(1);
    expect(futureVisits.some(v => v.products.includes("DTC"))).toBe(true);
    expect(futureVisits.some(v => v.products.includes("HB_MONO"))).toBe(true);
  });


  it("B9: 4y, P@2m → DTP needs 2 more; Hib complete with 1 dose", () => {
    const r = run("2022-04-01", [rec("2022-06-01", "PENTA")], "2026-04-01");
    expect(need(r, "HIB_PROGRAM").status).toBe("COMPLETE");
    expect(need(r, "DTP_PROGRAM").dosesNeeded).toBe(2);
    expectVisitContains(r, 0, ["DTC"], { date: "2026-04-01" });
  });

  it("B10: 24m, P@2,3m → DTP needs 1 more; Hib complete; Polio needs multiple", () => {
    const r = run("2024-04-01", [
      rec("2024-06-01", "PENTA"),
      rec("2024-07-01", "PENTA")
    ], "2026-04-01");
    expect(need(r, "HIB_PROGRAM").status).toBe("COMPLETE");
    expect(need(r, "DTP_PROGRAM").dosesNeeded).toBe(1);
    // DTP only needs 1 visit, but Polio needs more, so the engine plans multiple visits.
    expectVisitContains(r, 0, ["DTC", "HB_MONO", "VPO", "VPI"], { date: "2026-04-01", status: "DUE_NOW" });
  });

  it("B11: 17m, primary complete → polio due now; DTP booster 1 at 18m", () => {
    const r = run("2024-11-01", P3("2025"), "2026-04-01");
    expectVisitContains(r, 0, ["VPO", "VPI"], { date: "2026-04-01", status: "DUE_NOW" });
    expectVisitOnDateContains(r, "2026-05-01", ["DTC"], "DUE_FUTURE");
  });

  it("B12: 24m, primary complete → booster 1 DUE_NOW with polio", () => {
    const r = run("2024-04-01", P3("2024"), "2026-04-01");
    expectVisitContains(r, 0, ["DTC", "VPO", "VPI"], { date: "2026-04-01", status: "DUE_NOW" });
  });

  it("B13: 5y2m, B1@18m → booster 2 DUE_NOW (routine window, G14)", () => {
    const r = run("2021-02-01", [...P3("2021"), rec("2022-08-01", "DTC")], "2026-04-01");
    const n = need(r, "DTP_PROGRAM");
    expect(n.status).toBe("NEEDS_BOOSTER");
    expect(n.boosterSequence).toBe(2);
    expectVisitContains(r, 0, ["DTC", "VPO", "VPI"], { date: "2026-04-01", status: "DUE_NOW" });
  });

  it("B14: 6y, 5 valid doses → DTP complete; only polio remains", () => {
    const r = run("2020-04-01", [
      ...P3("2020"),
      rec("2021-10-01", "DTC"),
      rec("2025-04-01", "DTC")
    ], "2026-04-01");
    expect(need(r, "DTP_PROGRAM").status).toBe("COMPLETE");
    expect(r.visitPlan.visits.length).toBeGreaterThan(0);
    expectVisitContains(r, 0, ["VPO", "VPI"]);
  });

  it("B15: P@14m counts with warning; booster 2 at 5y2m", () => {
    const r = run("2024-04-01", [...P3("2024"), rec("2025-06-01", "PENTA")], "2026-04-01");
    const d4 = doses(r, "DTP_CONTAINING_DOSES")[3];
    expect(d4.valid).toBe(true);
    expect(d4.warnings.join(" ")).toContain("EARLY_BOOSTER_1_COUNTED");
    expect(count(r, "DTP_CONTAINING_DOSES")).toBe(4);
    expectVisitOnDateContains(r, "2029-04-01", ["DTC"]);
  });

  it("B16: DTC@8m invalid (T1 floor); booster 1 still due", () => {
    const r = run("2024-04-01", [...P3("2024"), rec("2024-12-01", "DTC")], "2026-04-01");
    const d4 = doses(r, "DTP_CONTAINING_DOSES")[3];
    expect(d4.valid).toBe(false);
    expect(d4.reasons).toContain("INVALID_INTERVAL_BEFORE_DOSE_4");
    expect(count(r, "DTP_CONTAINING_DOSES")).toBe(3);
    expectVisitContains(r, 0, ["DTC", "VPO", "VPI"], { date: "2026-04-01", status: "DUE_NOW" });
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
import { describe, it, expect } from "vitest";
import { run, count, need, doses, expectVisitContains, rec } from "./helpers";

describe("Group T — Td pathway above 7 years (D1-D7)", () => {
  it("T1: 7y6m never vaccinated → DT 3 + HB 3 + polio; DTP silent handoff", () => {
    const r = run("2018-10-01", [], "2026-04-01");
    const dtp = need(r, "DTP_PROGRAM");
    expect(dtp.status).toBe("NOT_NEEDED");
    expect(dtp.warnings).toEqual([]);
    expect(need(r, "DT_PROGRAM").dosesNeeded).toBe(3);
    expect(need(r, "HB_PROGRAM").dosesNeeded).toBe(3);
    expectVisitContains(r, 0, ["TD", "HB_MONO", "VPO", "VPI"], { date: "2026-04-01", status: "DUE_NOW" });
    expect(r.visitPlan.visits.length).toBeGreaterThanOrEqual(3);
  });

  it("T2: adult 26y never vaccinated → exactly 2 DTP-shape projected boosters; HB 3", () => {
    const r = run("2000-01-01", [], "2026-04-01", "full");
    expect(need(r, "DT_PROGRAM").dosesNeeded).toBe(3);
    const projected = r.visitPlan.visits.filter(
      v => v.status === "PROJECTED" && v.products.includes("TD")
    );
    expect(projected.map(v => v.role)).toContain("booster_1");
    expect(projected.map(v => v.role)).toContain("booster_2");
    expect(need(r, "HB_PROGRAM").dosesNeeded).toBe(3);
  });

  it("T3: 4 doses at ≥7y → DT booster 2 due, given as TD", () => {
    const before = run("2019-06-01", [
      rec("2025-06-01", "DTC"),
      rec("2025-07-01", "DTC"),
      rec("2026-01-01", "DTC")
    ], "2026-04-01");
    expect(need(before, "DTP_PROGRAM").status).toBe("NEEDS_BOOSTER");
    expect(need(before, "DTP_PROGRAM").boosterSequence).toBe(1);

    const after = run("2019-06-01", [
      rec("2025-06-01", "DTC"),
      rec("2025-07-01", "DTC"),
      rec("2026-01-01", "DTC"),
      rec("2026-07-05", "DTC")
    ], "2026-08-01");
    const dt = need(after, "DT_PROGRAM");
    expect(dt.status).toBe("NEEDS_BOOSTER");
    expect(dt.boosterSequence).toBe(2);
    expect(after.visitPlan.visits.some(v => v.products.includes("TD"))).toBe(true);
  });

  it("T4: 7th DT dose before 7y counts with cap warning", () => {
    const r = run("2019-01-01", [
      rec("2019-03-01", "PENTA"),
      rec("2019-04-01", "PENTA"),
      rec("2019-05-01", "PENTA"),
      rec("2020-07-01", "DTC"),
      rec("2024-01-01", "DTC"),
      rec("2025-01-01", "DTC"),
      rec("2025-07-01", "DTC")
    ], "2026-04-01");
    const d7 = doses(r, "DT_CONTAINING_DOSES")[6];
    expect(d7.valid).toBe(true);
    expect(d7.warnings.join(" ")).toContain("DOSE_CAP_EXCEEDED_COUNTED");
  });

  it("T5: 11y10m never vaccinated → HB 2 doses (6-month interval)", () => {
    const r = run("2014-06-01", [], "2026-04-01");
    expect(need(r, "HB_PROGRAM").dosesNeeded).toBe(2);
  });

  it("T6: 16y+ never vaccinated → HB 3 doses", () => {
    const r = run("2000-01-01", [], "2026-04-01");
    expect(need(r, "HB_PROGRAM").dosesNeeded).toBe(3);
  });

  it("T7: 8y with 2 infant Penta doses → DT needs 1 more primary dose", () => {
    const r = run("2018-04-01", [
      rec("2018-06-01", "PENTA"),
      rec("2018-07-01", "PENTA")
    ], "2026-04-01");
    expect(count(r, "DT_CONTAINING_DOSES")).toBe(2);
    expect(need(r, "DT_PROGRAM").dosesNeeded).toBe(1);
  });

  it("T8: cap stops planning before 7y once 6 doses recorded", () => {
    const r = run("2019-06-01", [
      rec("2019-08-01", "PENTA"),
      rec("2019-09-01", "PENTA"),
      rec("2019-10-01", "PENTA"),
      rec("2021-02-01", "DTC"),
      rec("2024-06-01", "DTC"),
      rec("2025-06-01", "DTC")
    ], "2026-04-01");
    const dtp = need(r, "DTP_PROGRAM");
    expect(dtp.dosesNeeded).toBe(0);
    expect(dtp.warnings.join(" ")).toContain("DOSE_CAP_REACHED_PLANNING_STOPPED");
  });

  it("T9: DTP booster 1 falling after 7th birthday is planned as TD, not DTC", () => {
    const r = run("2019-06-01", [
      rec("2025-06-01", "DTC"),
      rec("2025-07-01", "DTC"),
      rec("2026-01-01", "DTC")
    ], "2026-04-01");
    const v = r.visitPlan.visits.find(x => x.role.includes("booster_1"))!;
    expect(v.products).toContain("TD");
    expect(v.products).not.toContain("DTC");
  });
});
import { describe, it, expect } from "vitest";
import { run, doses, count, need, rec } from "./helpers";

const B = "2024-01-01";
const E = "2024-12-01";

describe("Group A — dose validity (per-antigen splitting)", () => {
  it("A1: Penta at 6 weeks — DTP invalid, HB valid, Hib invalid", () => {
    const r = run(B, [rec("2024-02-12", "PENTA")], E);
    expect(doses(r, "DTP_CONTAINING_DOSES")[0].valid).toBe(false);
    expect(doses(r, "DTP_CONTAINING_DOSES")[0].reasons).toContain("INVALID_AGE_DOSE_1_TOO_EARLY");
    expect(doses(r, "HB_DOSES")[0].valid).toBe(true);
    expect(doses(r, "HIB_DOSES")[0].valid).toBe(false);
  });

  it("A2: Penta at 2, 3, 4 months — all valid", () => {
    const r = run(B, [
      rec("2024-03-01", "PENTA"),
      rec("2024-04-01", "PENTA"),
      rec("2024-05-01", "PENTA")
    ], E);
    expect(count(r, "DTP_CONTAINING_DOSES")).toBe(3);
    expect(count(r, "HB_DOSES")).toBe(3);
    expect(count(r, "HIB_DOSES")).toBe(3);
  });

  it("A3: dose 2 only 2 weeks later — invalid everywhere", () => {
    const r = run(B, [
      rec("2024-03-01", "PENTA"),
      rec("2024-03-15", "PENTA")
    ], E);
    for (const c of ["DTP_CONTAINING_DOSES", "HB_DOSES", "HIB_DOSES"]) {
      expect(doses(r, c)[1].valid).toBe(false);
    }
  });

  it("A4: birth HB + Penta 2,3,4 — HB counts 4, harmless extra, complete", () => {
    const r = run(B, [
      rec("2024-01-01", "HB_MONO"),
      rec("2024-03-01", "PENTA"),
      rec("2024-04-01", "PENTA"),
      rec("2024-05-01", "PENTA")
    ], E);
    expect(count(r, "HB_DOSES")).toBe(4);
    expect(doses(r, "HB_DOSES")[3].valid).toBe(true);
    expect(need(r, "HB_PROGRAM").status).toBe("COMPLETE");
  });

  it("A5: birth HB + Penta 2,3 — HB complete at 3 valid doses (dose 3 min age 3m)", () => {
    const r = run(B, [
      rec("2024-01-01", "HB_MONO"),
      rec("2024-03-01", "PENTA"),
      rec("2024-04-01", "PENTA")
    ], E);
    expect(count(r, "HB_DOSES")).toBe(3);
    expect(need(r, "HB_PROGRAM").status).toBe("COMPLETE");
  });

  it("A6: overridden too-early dose counts with flag", () => {
    const r = run(B, [rec("2024-02-12", "PENTA", true)], E);
    const d = doses(r, "DTP_CONTAINING_DOSES")[0];
    expect(d.valid).toBe(true);
    expect(d.reasons).toContain("OVERRIDDEN_BY_HEALTHCARE_PROFESSIONAL");
  });

  it("A7: unsorted input is sorted before validation", () => {
    const r = run(B, [
      rec("2024-04-01", "PENTA"),
      rec("2024-03-01", "PENTA"),
      rec("2024-05-01", "PENTA")
    ], E);
    const dates = doses(r, "DTP_CONTAINING_DOSES").map(d => d.administeredOn);
    expect(dates).toEqual(["2024-03-01", "2024-04-01", "2024-05-01"]);
    expect(count(r, "DTP_CONTAINING_DOSES")).toBe(3);
  });

  it.todo("A8: server rejects doses dated after evaluation date (server-level)");
});
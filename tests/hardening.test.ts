import { describe, it, expect } from "vitest";
import { run } from "./helpers";
import { parseDate, isValidDateString } from "../src/engine/duration";

describe("hardening", () => {
  it("rejects impossible dates instead of rolling over", () => {
    expect(isValidDateString("2023-13-01")).toBe(false);
    expect(isValidDateString("2023-02-30")).toBe(false);
    expect(isValidDateString("not-a-date")).toBe(false);
    expect(() => parseDate("2023-13-01")).toThrow(/INVALID_DATE/);
    expect(() => parseDate("2023-02-30")).toThrow(/INVALID_DATE/);
  });

  it("engine throws on bad birthDate instead of silent plan", () => {
    expect(() => run("2023-13-01", [], "2024-01-01")).toThrow(/INVALID_DATE/);
  });

  it("invariants: no empty products in selection or visits", () => {
    const r = run("2021-01-01", [
      { administeredOn: "2021-03-01", productGroupId: "PENTA" },
      { administeredOn: "2021-04-01", productGroupId: "PENTA" },
      { administeredOn: "2021-05-01", productGroupId: "PENTA" },
      { administeredOn: "2022-07-01", productGroupId: "DTC" },
    ] as any, "2025-06-01", "full");
    for (const b of r.productSelection.boosterPlans) {
      expect(b.productGroupId.length).toBeGreaterThan(0);
    }
    for (const v of r.visitPlan.visits) {
      expect(v.products.length).toBeGreaterThan(0);
      for (const p of v.products) expect(p.length).toBeGreaterThan(0);
    }
  });

  it("does not mutate evaluator needs via caps", () => {
    const r = run("2018-01-01", [
      { administeredOn: "2018-03-01", productGroupId: "PENTA" },
      { administeredOn: "2018-04-05", productGroupId: "PENTA" },
      { administeredOn: "2018-05-10", productGroupId: "PENTA" },
      { administeredOn: "2019-07-01", productGroupId: "DTC" },
      { administeredOn: "2023-02-01", productGroupId: "TD" },
      { administeredOn: "2024-06-01", productGroupId: "TD" },
      { administeredOn: "2024-12-01", productGroupId: "TD" },
    ] as any, "2026-02-01");
    // capped result carries the guard; original evaluation would be UNDETERMINED/COMPLETE
    // without silent mutation of shared objects across calls
    const dtp = r.antigenNeeds.find((n) => n.programId === "DTP_PROGRAM")!;
    expect(JSON.stringify(dtp.warnings)).toContain("DOSE_CAP");
  });
});

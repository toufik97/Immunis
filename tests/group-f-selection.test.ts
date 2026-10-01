import { describe, it, expect } from "vitest";
import { run, need, expectVisitContains, rec } from "./helpers";

describe("Group F — product selection (inclusion-based)", () => {
  it("F1: Hib due with DTP booster → Penta present, DTC absent same visit", () => {
    const r = run("2024-08-01", [
      rec("2025-08-01", "DTC"),
      rec("2025-09-01", "DTC"),
      rec("2026-03-01", "DTC")
    ], "2026-04-01");

    expectVisitContains(r, 0, ["PENTA"], { forbidden: ["DTC"] });

    for (const v of r.visitPlan.visits) {
      const hasBoth = v.products.includes("DTC") && v.products.includes("PENTA");
      expect(hasBoth, `visit on ${v.date} mixes DTC and PENTA`).toBe(false);
    }
  });

  it("F2: Hib needed but Penta ineligible → unmet warning, no silent skip", () => {
    const r = run("2022-04-01", [], "2026-04-01");
    expect(r.productSelection.warnings.join(" ")).toContain("HIB_PROGRAM");
  });

  it("F3: DTP+HB needed, Hib not → DTC + HB_MONO, no Penta", () => {
    const r = run("2024-04-01", [rec("2024-06-01", "PENTA")], "2026-04-01");
    expectVisitContains(r, 0, ["DTC", "HB_MONO"], { forbidden: ["PENTA"] });
  });
});
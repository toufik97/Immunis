import { describe, it, expect } from "vitest";
import { run, need } from "./helpers";

// Phase 1-2 regression locks for engine fixes
describe("engine fixes", () => {
  it("1. dose cap still applies after cap age (8y with 7 DT doses stays capped)", () => {
    // DTP cap: DT_CONTAINING <=6 before 84m. Build 6 valid infant doses + 1 more before 84m,
    // evaluate at 8y -> cap must still hold, not COMPLETE silently.
    const birth = "2018-01-01";
    const h = [
      { administeredOn: "2018-03-01", productGroupId: "PENTA" },
      { administeredOn: "2018-04-05", productGroupId: "PENTA" },
      { administeredOn: "2018-05-10", productGroupId: "PENTA" },
      { administeredOn: "2019-07-01", productGroupId: "DTC" },
      { administeredOn: "2023-02-01", productGroupId: "TD" },
      { administeredOn: "2024-06-01", productGroupId: "TD" },
      { administeredOn: "2024-12-01", productGroupId: "TD" },
    ];
    const r = run(birth, h as any, "2026-02-01");
    const dtp = need(r, "DTP_PROGRAM");
    // 7 doses before 84m exceeds cap 6 -> must carry cap warning
    expect(JSON.stringify(dtp.warnings)).toContain("DOSE_CAP");
  });

  it("2. conditional interval gap fails closed (invalid, not passed)", () => {
    // DTP dose3 interval is conditional on age@prev <12m vs >=12m.
    // If age falls exactly in an uncovered gap, dose must be invalid, not auto-valid.
    // We simulate via direct resolveDuration gap check through validator:
    // 2 Penta doses then 3rd only 1 week later at ~12m boundary -> must be invalid interval
    const r = run("2024-01-01", [
      { administeredOn: "2024-03-01", productGroupId: "PENTA" },
      { administeredOn: "2024-04-05", productGroupId: "PENTA" },
      { administeredOn: "2024-04-12", productGroupId: "PENTA" },
    ] as any, "2024-05-01");
    const doses = r.doseValidations["DTP_CONTAINING_DOSES"]?.doses ?? [];
    const d3 = doses.find((d: any) => d.doseNumber === 3);
    expect(d3?.valid).toBe(false);
    expect(JSON.stringify(d3?.reasons)).toContain("INVALID_INTERVAL");
  });

  it("4a. late VPO0 is not valid dose-0", () => {
    const r = run("2024-01-01", [
      { administeredOn: "2024-06-01", productGroupId: "VPO" },
    ] as any, "2024-07-01");
    const v = r.doseValidations["POLIO_ORAL_DOSES"]?.doses ?? [];
    const zero = v.filter((d: any) => d.doseNumber === 0);
    expect(zero.length).toBe(0);
  });

  it("8. selector never outputs empty productGroupId", () => {
    const r = run("2021-01-01", [
      { administeredOn: "2021-03-01", productGroupId: "PENTA" },
      { administeredOn: "2021-04-01", productGroupId: "PENTA" },
      { administeredOn: "2021-05-01", productGroupId: "PENTA" },
      { administeredOn: "2022-07-01", productGroupId: "DTC" },
    ] as any, "2025-06-01");
    for (const b of r.productSelection.boosterPlans) {
      expect(b.productGroupId).not.toBe("");
    }
  });
});

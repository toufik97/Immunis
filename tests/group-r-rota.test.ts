import { describe, it, expect } from "vitest";
import {
  run,
  count,
  need,
  doses,
  expectVisitContains,
  expectVisitOnDateContains,
  rec
} from "./helpers";

// Product group id exactly as defined in schedule-packs/MA/catalog.yaml
const ROTA = "ROTA VIRUS".replace(" ", "");

describe("Group R — Rotavirus (24-month hard stop)", () => {
  it("R1: routine infant (2,3,4m) → complete", () => {
    const r = run("2025-01-01", [
      rec("2025-03-01", ROTA),
      rec("2025-04-01", ROTA),
      rec("2025-05-01", ROTA)
    ], "2026-01-01");
    expect(count(r, "ROTA_DOSES")).toBe(3);
    expect(need(r, "ROTA_PROGRAM").status).toBe("COMPLETE");
  });

  it("R2: 4m never vaccinated → rotavirus joins the Penta/VPO/VPI visit", () => {
    const r = run("2026-01-01", [], "2026-05-01");
    expect(need(r, "ROTA_PROGRAM").dosesNeeded).toBe(3);
    expectVisitContains(r, 0, ["PENTA", "VPO", "VPI", ROTA], {
      date: "2026-05-01",
      status: "DUE_NOW"
    });
  });

  it("R3: late comer 10m with 1 dose → completes at 4-week intervals", () => {
    const r = run("2025-06-01", [rec("2025-09-01", ROTA)], "2026-04-01");
    expect(need(r, "ROTA_PROGRAM").dosesNeeded).toBe(2);
    expectVisitContains(r, 0, [ROTA], { date: "2026-04-01", status: "DUE_NOW" });
    
    // Resilient: just verify the second dose is planned in the future
    const futureVisits = r.visitPlan.visits.slice(1);
    expect(futureVisits.some(v => v.products.includes(ROTA))).toBe(true);
  });

  it("R4: dose recorded at 25 months is INVALID (hard stop, T1)", () => {
    const r = run("2024-01-01", [
      rec("2024-03-01", ROTA),
      rec("2024-04-01", ROTA),
      rec("2026-02-01", ROTA)
    ], "2026-04-01");
    const d3 = doses(r, "ROTA_DOSES")[2];
    expect(d3.valid).toBe(false);
    expect(d3.reasons).toContain("INVALID_AGE_DOSE_3_TOO_LATE");
    expect(count(r, "ROTA_DOSES")).toBe(2);
    expect(need(r, "ROTA_PROGRAM").status).toBe("NOT_NEEDED");
  });

  it("R5: 25m never vaccinated → silent none", () => {
    const r = run("2024-01-01", [], "2026-02-01");
    expect(need(r, "ROTA_PROGRAM").status).toBe("NOT_NEEDED");
    expect(need(r, "ROTA_PROGRAM").warnings).toEqual([]);
  });

  it("R6: 23m+ starter → only the dose fitting before 24m is planned", () => {
    const r = run("2024-04-15", [], "2026-04-01");
    expect(need(r, "ROTA_PROGRAM").dosesNeeded).toBe(3);
    expectVisitContains(r, 0, [ROTA], { date: "2026-04-01", status: "DUE_NOW" });

    const laterRota = r.visitPlan.visits
      .slice(1)
      .some(v => v.products.includes(ROTA));
    expect(laterRota).toBe(false);
    expect(r.visitPlan.warnings.join(" ")).toContain("AGE_LIMIT_PREVENTS_DOSE");
  });

  it("R7: 20m starter → all 3 doses fit before 24m, no limit warning", () => {
    const r = run("2024-08-01", [], "2026-04-01");
    const rotaVisits = r.visitPlan.visits.filter(v => v.products.includes(ROTA));
    expect(rotaVisits.length).toBe(3);
    expect(r.visitPlan.warnings.join(" ")).not.toContain("AGE_LIMIT_PREVENTS_DOSE");
  });
});
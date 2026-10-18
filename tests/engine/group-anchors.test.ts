import { describe, it, expect } from "vitest";
import { run, rec, expectVisit, expectVisitOnDateContains } from "./helpers";
import { alignAnchors } from "../../src/engine/visit-planner";
import type { ImmunizationRecord } from "../../src/types";

// Field case TEST-287: PENTA/VPO/ROTA twice, then PrimoVax.
// The PCV→PENTA 14d fiche rule pushes PENTA one day past the trio;
// anchors pull the trio forward instead of leaving a straggler visit.
const BIRTH = "2026-06-06";
function history287(pcvdDate: string, extra: ImmunizationRecord[] = []): ImmunizationRecord[] {
  return [
    rec("2026-07-08", "BCG"),
    rec("2026-07-08", "VPO"),
    rec("2026-07-08", "VITD"),
    rec("2026-07-08", "HB_MONO"),
    rec("2026-08-12", "PENTA"),
    rec("2026-08-12", "VPO"),
    rec("2026-08-12", "ROTAVIRUS"),
    rec("2026-09-16", "PENTA"),
    rec("2026-09-16", "VPO"),
    rec("2026-09-16", "ROTAVIRUS"),
    rec(pcvdDate, "PCV_PRIMOVAX"),
    ...extra,
  ];
}

describe("Co-administration anchors (follow PENTA forward)", () => {
  it("reunites a 1-day spacing split into one visit", () => {
    const r = run(BIRTH, history287("2026-10-01"), "2026-10-01", "full");
    expectVisit(r, 0, "2026-10-15", ["VPI", "VPO", "ROTAVIRUS", "PENTA"], "DUE_FUTURE");
    expect(r.visitPlan.warnings.some((w) => w.startsWith("ANCHORED"))).toBe(true);
  });

  it("reunites regardless of spread (no window): 10-day split", () => {
    // PCV on 10-10 pushes PENTA to 10-24; the trio follows it there.
    const r = run(BIRTH, history287("2026-10-10"), "2026-10-10", "full");
    expectVisit(r, 0, "2026-10-24", ["VPI", "VPO", "ROTAVIRUS", "PENTA"], "DUE_FUTURE");
  });

  it("never pulls earlier: live-pushed followers stay put", () => {
    // A recorded live RR on 10-10 pushes live VPO/ROTA to 11-07, past the
    // PENTA anchor (10-15). Forward-only: they stay, no anchor warning for them.
    const r = run(BIRTH, history287("2026-10-01", [rec("2026-10-10", "RR")]), "2026-10-10", "full");
    expectVisitOnDateContains(r, "2026-10-15", ["PENTA", "VPI"], "DUE_FUTURE", { forbidden: ["VPO", "ROTAVIRUS"] });
    expectVisitOnDateContains(r, "2026-11-07", ["VPO", "ROTAVIRUS"]);
    expect(r.visitPlan.warnings.some((w) => w.startsWith("ANCHORED: VPO"))).toBe(false);
    expect(r.visitPlan.warnings.some((w) => w.startsWith("ANCHORED: ROTAVIRUS"))).toBe(false);
  });

  it("refuses moves past the age limit instead of dropping the dose", () => {
    // Unit level: ROTA ready 10-20, PENTA anchor 10-25 past ROTA's 24-month
    // cliff (latest 10-24). ROTA keeps its date and stays planned.
    const d = (s: string) => new Date(`${s}T00:00:00`);
    const visits = [
      { date: d("2026-10-20"), productGroupId: "ROTAVIRUS", kind: "primary", latest: d("2026-10-24") },
      { date: d("2026-10-20"), productGroupId: "VPO", kind: "primary", latest: null },
      { date: d("2026-10-25"), productGroupId: "PENTA", kind: "primary", latest: null },
    ];
    const warnings = alignAnchors(visits, new Map([["ROTAVIRUS", "PENTA"], ["VPO", "PENTA"]]));
    expect(visits[0].date).toEqual(d("2026-10-20"));
    expect(visits[1].date).toEqual(d("2026-10-25"));
    expect(warnings.some((w) => w.startsWith("ANCHOR_SKIPPED_AGE_LIMIT"))).toBe(true);
    expect(warnings.some((w) => w.startsWith("ANCHORED: VPO"))).toBe(true);
  });

  it("ignores earlier anchors and birth visits", () => {
    const d = (s: string) => new Date(`${s}T00:00:00`);
    const visits = [
      { date: d("2026-11-07"), productGroupId: "VPO", kind: "primary", latest: null },
      { date: d("2026-10-15"), productGroupId: "PENTA", kind: "primary", latest: null },
      { date: d("2026-10-15"), productGroupId: "VPO", kind: "birth", latest: null },
    ];
    const warnings = alignAnchors(visits, new Map([["VPO", "PENTA"]]));
    expect(visits[0].date).toEqual(d("2026-11-07"));
    expect(visits[2].date).toEqual(d("2026-10-15"));
    expect(warnings).toEqual([]);
  });

  it("leaves unanchored antigens on pure proximity clustering", () => {
    const r = run(BIRTH, history287("2026-10-01"), "2026-10-01", "full");
    // VITA/VITD have no anchors: later visits keep their own dates.
    expectVisitOnDateContains(r, "2026-12-06", ["PCV_PRIMOVAX", "VITA"]);
  });
});

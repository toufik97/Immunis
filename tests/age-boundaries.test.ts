// Age-boundary tests for fix #1 (single, date-based age predicate).
// Expects ./src next to ./tests. Point ENGINE_SRC at another checkout to compare, e.g.
//   ENGINE_SRC=../old-checkout/src npx vitest run   (helper tests skip themselves if the helpers are missing)
import { describe, it, expect } from "vitest";

const root = process.env.ENGINE_SRC ?? "../src";
const { loadSchedulePack } = await import(`${root}/loader`);
const { evaluatePatient } = await import(`${root}/engine`);
const dur: any = await import(`${root}/engine/duration`);
const sel: any = await import(`${root}/engine/product-selector`);
const { parseDate, formatDate, addDurationToDate } = dur;

const pack = loadSchedulePack("MA");
const itP = typeof dur.isAgeAtLeast === "function" ? it : it.skip; // helpers only exist after the fix

const evalAt = (birth: string, on: string, history: any[] = [], opts: any = {}) =>
  evaluatePatient({ birthDate: birth }, history, pack, parseDate(on), opts);

const dose = (r: any, counter: string, n = 0) => r.doseValidations[counter].doses[n];

describe("age helpers", () => {
  itP("isAgeAtLeast / isAgeBefore use calendar thresholds", () => {
    const b = parseDate("2026-01-01");
    expect(dur.isAgeAtLeast(b, parseDate("2026-02-26"), { weeks: 8 })).toBe(true);
    expect(dur.isAgeAtLeast(b, parseDate("2026-02-25"), { weeks: 8 })).toBe(false);
    expect(dur.isAgeBefore(b, parseDate("2026-02-26"), { weeks: 8 })).toBe(false);
    expect(dur.isAgeBefore(b, parseDate("2026-02-25"), { weeks: 8 })).toBe(true);
  });
  itP("birth:true means from birth, and dates before birth fail", () => {
    const b = parseDate("2026-01-01");
    expect(dur.isAgeAtLeast(b, b, { birth: true })).toBe(true);
    expect(dur.isAgeAtLeast(b, parseDate("2025-12-31"), { birth: true })).toBe(false);
  });
  itP("month-end births clamp to the last day of a shorter month", () => {
    const b = parseDate("2025-12-31");
    expect(dur.isAgeAtLeast(b, parseDate("2026-02-28"), { months: 2 })).toBe(true);
    expect(dur.isAgeAtLeast(b, parseDate("2026-02-27"), { months: 2 })).toBe(false);
  });
  itP("isProductEligible: exclusive max_age is a strict date bound", () => {
    const rules = [{ product_group: "PENTA", max_age: { years: 3, exclusive: true } }];
    const b = parseDate("2023-04-01");
    expect(sel.isProductEligible("PENTA", b, parseDate("2026-03-31"), rules)).toBe(true);
    expect(sel.isProductEligible("PENTA", b, parseDate("2026-04-01"), rules)).toBe(false);
  });
});

describe("week-based limits (the main bug)", () => {
  it("PCV dose 1 at exactly 8 weeks is valid", () => {
    const r = evalAt("2026-01-01", "2026-03-01", [{ administeredOn: "2026-02-26", productGroupId: "PCV_PREVENAR" }]);
    expect(dose(r, "PCV_DOSES").reasons).toEqual([]);
    expect(dose(r, "PCV_DOSES").valid).toBe(true);
  });
  it("PCV dose 1 at 8 weeks minus one day is invalid", () => {
    const r = evalAt("2026-01-01", "2026-03-01", [{ administeredOn: "2026-02-25", productGroupId: "PCV_PREVENAR" }]);
    expect(dose(r, "PCV_DOSES").reasons).toContain("INVALID_AGE_DOSE_1_TOO_EARLY");
  });
  it("PrimoVax target age (10 weeks): no early warning at day 70, warning at day 69", () => {
    const ok = evalAt("2026-01-01", "2026-03-20", [{ administeredOn: "2026-03-12", productGroupId: "PCV_PRIMOVAX" }]);
    expect(dose(ok, "PCV_DOSES").warnings.some((w: string) => w.startsWith("EARLY_DOSE_1_COUNTED"))).toBe(false);
    const early = evalAt("2026-01-01", "2026-03-20", [{ administeredOn: "2026-03-11", productGroupId: "PCV_PRIMOVAX" }]);
    expect(dose(early, "PCV_DOSES").warnings.some((w: string) => w.startsWith("EARLY_DOSE_1_COUNTED"))).toBe(true);
  });
  it("birth-dose window 'weeks: 4' means the first 28 days (behavior change, confirm)", () => {
    const day27 = evalAt("2026-01-01", "2026-01-28");
    const day28 = evalAt("2026-01-01", "2026-01-29");
    const hb = (r: any) => r.productSelection.birthDosePlans.some((p: any) => p.programId === "HB_PROGRAM");
    expect(hb(day27)).toBe(true);
    expect(hb(day28)).toBe(false);
  });
});

describe("month-based limits keep their behavior", () => {
  const rule = (b: string, on: string, program: string) =>
    evalAt(b, on).antigenNeeds.find((n: any) => n.programId === program)?.matchedRuleId;
  it("HB switches rule on the 11th birthday", () => {
    expect(rule("2015-04-01", "2026-03-31", "HB_PROGRAM")).toBe("MA-HB-CU-LT11Y-0D");
    expect(rule("2015-04-01", "2026-04-01", "HB_PROGRAM")).toBe("MA-HB-CU-11Y-16Y-0D");
  });
  it("Rota stops at 24 months", () => {
    expect(rule("2024-04-01", "2026-03-31", "ROTA_PROGRAM")).toBe("MA-ROTA-CU-LT24M-0D");
    expect(rule("2024-04-01", "2026-04-01", "ROTA_PROGRAM")).toBe("MA-ROTA-CU-GE24M");
  });
  it("VPO before 2 months is dose 0, at 2 months is dose 1", () => {
    const z = evalAt("2026-01-01", "2026-03-10", [{ administeredOn: "2026-02-28", productGroupId: "VPO" }]);
    expect(dose(z, "POLIO_ORAL_DOSES").doseNumber).toBe(0);
    const o = evalAt("2026-01-01", "2026-03-10", [{ administeredOn: "2026-03-01", productGroupId: "VPO" }]);
    expect(dose(o, "POLIO_ORAL_DOSES").doseNumber).toBe(1);
  });
  it("Penta dose 1 on the 2-month day is valid, the day before is not", () => {
    const ok = evalAt("2026-01-15", "2026-03-20", [{ administeredOn: "2026-03-15", productGroupId: "PENTA" }]);
    const early = evalAt("2026-01-15", "2026-03-20", [{ administeredOn: "2026-03-14", productGroupId: "PENTA" }]);
    expect(dose(ok, "DTP_CONTAINING_DOSES").valid).toBe(true);
    expect(dose(early, "DTP_CONTAINING_DOSES").valid).toBe(false);
  });
});

describe("month-end births (behavior change, confirm)", () => {
  it("born Mar 31: vitamin A dose 1 on Sep 30 counts as the 6-month day", () => {
    const r = evalAt("2025-03-31", "2025-10-05", [{ administeredOn: "2025-09-30", productGroupId: "VITA_100K" }]);
    expect(dose(r, "VITA_DOSES").valid).toBe(true);
  });
  it("born Mar 31: the day before (Sep 29) is still too early", () => {
    const r = evalAt("2025-03-31", "2025-10-05", [{ administeredOn: "2025-09-29", productGroupId: "VITA_100K" }]);
    expect(dose(r, "VITA_DOSES").valid).toBe(false);
  });
});

describe("planner and validator agree on age", () => {
  // Plan the whole schedule, record every visit as given, re-run, and require that
  // no recorded dose is rejected for AGE. Interval problems are other bugs (items 4/5).
  it("no planned dose is rejected as too early / too late", () => {
    const bad: string[] = [];
    let births = 0;
    for (let d = parseDate("2025-11-25"); d <= parseDate("2026-03-10"); d = addDurationToDate(d, { days: 1 })) {
      births++;
      const birth = formatDate(d);
      const first = evalAt(birth, birth, [], { projection: "full" });
      const history = first.visitPlan.visits.flatMap((v: any) =>
        v.products.map((p: string) => ({ administeredOn: v.date, productGroupId: p }))
      );
      if (!history.length) continue;
      const last = history.map((h: any) => h.administeredOn).sort().pop()!;
      const second = evalAt(birth, last, history, { projection: "full" });
      for (const [counter, v] of Object.entries<any>(second.doseValidations)) {
        for (const x of v.doses) {
          if (x.reasons.some((r: string) => r.startsWith("INVALID_AGE"))) {
            bad.push(`${birth} ${counter} dose ${x.doseNumber} ${x.productGroupId} ${x.administeredOn}: ${x.reasons.join(",")}`);
          }
        }
      }
    }
    expect(births).toBeGreaterThan(100);
    expect(bad).toEqual([]);
  });
});

// Batch 3: eligibility on the visit's own date, vitamin dose amounts, dose details, history aliases.
// Expects ./src next to ./test and the pack in ./schedule-packs (run from the project root).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.env.ENGINE_SRC ?? "../src";
const { loadSchedulePack } = await import(`${root}/loader`);
const { evaluatePatient } = await import(`${root}/engine`);
const { parseDate } = await import(`${root}/engine/duration`);

const pack = loadSchedulePack("MA");
const evalAt = (birth: string, on: string, history: any[] = [], opts: any = {}) =>
  evaluatePatient({ birthDate: birth }, history, pack, parseDate(on), opts);
const visitsWith = (r: any, product: string) => r.visitPlan.visits.filter((v: any) => v.products.includes(product));
const warn = (r: any, code: string) => r.visitPlan.warnings.filter((w: string) => w.startsWith(code));

describe("product eligibility is checked on the visit's own date", () => {
  it("DTC stops at 7 years: later doses of a 6y11m child use TD", () => {
    const r = evalAt("2019-03-15", "2026-03-01"); // 7th birthday is 2026-03-15
    expect(visitsWith(r, "DTC").every((v: any) => v.date < "2026-03-15")).toBe(true);
    expect(visitsWith(r, "TD").length).toBeGreaterThan(0);
    expect(warn(r, "PRODUCT_SUBSTITUTED_BY_AGE").length).toBeGreaterThan(0);
  });
  it("VPI stops at 8 years: a second dose that would fall after it is not planned, with a warning", () => {
    const r = evalAt("2018-03-15", "2026-03-01"); // 8th birthday is 2026-03-15
    expect(visitsWith(r, "VPI").every((v: any) => v.date < "2026-03-15")).toBe(true);
    expect(warn(r, "NO_ELIGIBLE_PRODUCT_AT_DATE").some((w: string) => w.includes("VPI_PROGRAM"))).toBe(true);
  });
  it("no planned visit uses a product that is ineligible on that visit's date", () => {
    const rules: any[] = (pack.productSelection as any).product_selection.eligibility;
    const bad: string[] = [];
    for (const [birth, ev] of [["2019-03-15", "2026-03-01"], ["2018-03-15", "2026-03-01"], ["2023-04-01", "2026-03-01"], ["2024-04-20", "2026-03-01"], ["2020-01-01", "2026-03-01"]]) {
      const r = evalAt(birth, ev, [], { projection: "full" });
      for (const v of r.visitPlan.visits) for (const p of v.products) {
        const rule = rules.find(x => x.product_group === p);
        if (!rule?.max_age) continue;
        const limit = new Date(parseDate(birth)); limit.setFullYear(limit.getFullYear() + (rule.max_age.years ?? 0)); limit.setMonth(limit.getMonth() + (rule.max_age.months ?? 0));
        if (parseDate(v.date) >= limit) bad.push(`${birth}: ${p} on ${v.date}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("vitamins: one product, the dose amount comes from the schedule", () => {
  const r = evalAt("2026-01-01", "2026-01-10", [], { projection: "full" });
  const doses = r.visitPlan.visits.flatMap((v: any) => v.doses);
  const of = (program: string) => doses.filter((d: any) => d.programId === program).sort((a: any, b: any) => a.doseNumber - b.doseNumber);

  it("vitamin A: 100 000 IU, then 200 000 IU twice, always product VITA", () => {
    expect(of("VITA_PROGRAM").map((d: any) => [d.doseNumber, d.amount?.value, d.amount?.unit, d.productGroupId])).toEqual([
      [1, 100000, "IU", "VITA"], [2, 200000, "IU", "VITA"], [3, 200000, "IU", "VITA"]
    ]);
  });
  it("vitamin D: 200 000 IU for both doses", () => {
    expect(of("VITD_PROGRAM").map((d: any) => [d.doseNumber, d.amount?.value])).toEqual([[1, 200000], [2, 200000]]);
  });
  it("vitamins are marked as supplements, vaccines as vaccines, and vaccines carry no amount", () => {
    expect(of("VITA_PROGRAM").every((d: any) => d.category === "supplement")).toBe(true);
    const penta = r.visitPlan.visits.find((v: any) => v.products.includes("PENTA"));
    const pentaDoses = penta.doses.filter((d: any) => d.productGroupId === "PENTA");
    expect(pentaDoses.map((d: any) => d.programId).sort()).toEqual(["DTP_PROGRAM", "HB_PROGRAM", "HIB_PROGRAM"]);
    expect(penta.doses.every((d: any) => d.category === "vaccine" && d.amount === undefined)).toBe(true);
  });
  it("the retired ids VITA_100K / VITA_200K never appear in a plan", () => {
    expect(JSON.stringify(r.visitPlan)).not.toMatch(/VITA_(100|200)K/);
  });
});

describe("history: aliases and unknown products", () => {
  it("a recorded VITA_100K counts as a vitamin A dose", () => {
    const r = evalAt("2025-01-01", "2025-09-01", [{ administeredOn: "2025-07-15", productGroupId: "VITA_100K" }]);
    expect(r.doseCounts.VITA_DOSES).toBe(1);
    expect(r.inputWarnings).toEqual([]);
  });
  it("an unknown product id is reported instead of silently ignored", () => {
    const r = evalAt("2026-01-01", "2026-04-01", [{ administeredOn: "2026-03-01", productGroupId: "PENTAA" }]);
    expect(r.inputWarnings.length).toBe(1);
    expect(r.inputWarnings[0]).toMatch(/UNKNOWN_PRODUCT_IN_HISTORY.*PENTAA/);
    expect(r.doseCounts.DTP_CONTAINING_DOSES).toBe(0);
  });
});

describe("pack validation for the new fields", () => {
  const here = path.resolve(process.cwd(), "schedule-packs");
  function mutated(file: string, from: string | RegExp, to: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-"));
    fs.cpSync(here, dir, { recursive: true, dereference: true });
    const p = path.join(dir, "MA", file);
    const before = fs.readFileSync(p, "utf8");
    const after = before.replace(from, to);
    expect(after).not.toBe(before);
    fs.writeFileSync(p, after);
    return dir;
  }
  const load = (dir: string) => () => loadSchedulePack("MA", dir);
  it("rejects a dose_amount without a positive number", () => {
    expect(load(mutated("programs/vita.yaml", "dose_amount: { value: 100000, unit: IU }", "dose_amount: { value: lots, unit: IU }"))).toThrow(/dose_amount/);
  });
  it("rejects a dose_amount without a unit", () => {
    expect(load(mutated("programs/vitd.yaml", "dose_amount: { value: 200000, unit: IU }", "dose_amount: { value: 200000 }"))).toThrow(/dose_amount/);
  });
  it("rejects an alias that is also a product id", () => {
    expect(load(mutated("catalog.yaml", "      - VITA_200K", "      - VITD"))).toThrow(/alias "VITD"/);
  });
  it("rejects an unknown category", () => {
    expect(load(mutated("catalog.yaml", /category: supplement(\r?\n\s+aliases:)/, "category: suplement$1"))).toThrow(/category/);
  });
});

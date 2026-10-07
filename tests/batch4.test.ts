// Batch 4: the PrimoVax 15-day offset, dose intervals kept during spacing, calendar-month intervals.
// Expects ./src next to ./test and the pack in ./schedule-packs (run from the project root).
import { describe, it, expect } from "vitest";

const root = process.env.ENGINE_SRC ?? "../src";
const { loadSchedulePack } = await import(`${root}/loader`);
const { evaluatePatient } = await import(`${root}/engine`);
const { scheduleWithSpacing } = await import(`${root}/engine/spacing`);
const { parseDate, formatDate, addDurationToDate } = await import(`${root}/engine/duration`);

const pack = loadSchedulePack("MA");
const run = (birth: string, on: string, history: any[] = [], opts: any = {}) =>
  evaluatePatient({ birthDate: birth }, history, pack, parseDate(on), opts);
const datesOf = (r: any, product: string) =>
  r.visitPlan.visits.filter((v: any) => v.products.includes(product)).map((v: any) => v.date).sort();
const days = (a: string, b: string) => Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
const warns = (r: any, re: RegExp) => r.visitPlan.warnings.filter((w: string) => re.test(w));

describe("PrimoVax and Penta/DTC/Td are 15 days apart; whoever is due first keeps its date", () => {
  it("example 1: both due now -> Penta now, PrimoVax 15 days later, next Penta 15 after PrimoVax", () => {
    const r = run("2026-01-01", "2026-03-16", [], { projection: "full" });
    const penta = datesOf(r, "PENTA"), primo = datesOf(r, "PCV_PRIMOVAX");
    expect(penta[0]).toBe("2026-03-16");
    expect(primo[0]).toBe("2026-03-31");
    expect(days(primo[0], penta[1])).toBeGreaterThanOrEqual(15);
    expect(days(penta[0], penta[1])).toBeGreaterThanOrEqual(28); // Penta interval still respected
  });
  it("example 2: Penta given at 2 months, PrimoVax due now -> PrimoVax now (exactly 15 days after is fine)", () => {
    const r = run("2026-01-01", "2026-03-16", [{ administeredOn: "2026-03-01", productGroupId: "PENTA" }], { projection: "full" });
    expect(datesOf(r, "PCV_PRIMOVAX")[0]).toBe("2026-03-16");
    expect(days("2026-03-16", datesOf(r, "PENTA")[0])).toBeGreaterThanOrEqual(15);
  });
  it("example 2b: PrimoVax due now, next Penta would be too close -> the Penta moves, not the PrimoVax", () => {
    const r = run("2026-01-01", "2026-03-20", [{ administeredOn: "2026-03-01", productGroupId: "PENTA" }], { projection: "full" });
    expect(datesOf(r, "PCV_PRIMOVAX")[0]).toBe("2026-03-20");
    expect(datesOf(r, "PENTA")[0]).toBe("2026-04-04"); // 15 days after the PrimoVax
    expect(warns(r, /^SPACING_SHIFT: PENTA/).length).toBe(1);
    expect(warns(r, /^SPACING_SHIFT: PCV_PRIMOVAX/).length).toBe(0);
  });
  it("a recorded PrimoVax pushes the next planned Penta, never the other way round", () => {
    const r = run("2026-01-01", "2026-03-20", [{ administeredOn: "2026-03-10", productGroupId: "PCV_PRIMOVAX" }], { projection: "full" });
    expect(days("2026-03-10", datesOf(r, "PENTA")[0])).toBeGreaterThanOrEqual(15);
  });
  it("Prevenar has no offset: it can share a day with Penta", () => {
    const r = run("2026-01-01", "2026-05-01", [{ administeredOn: "2026-03-01", productGroupId: "PCV_PREVENAR" }], { projection: "full" });
    const same = r.visitPlan.visits.find((v: any) => v.products.includes("PENTA") && v.products.includes("PCV_PREVENAR"));
    expect(same).toBeTruthy();
    expect(warns(r, /PCV_PREVENAR/).length).toBe(0);
  });
  it("a catch-up child keeps all three PrimoVax doses, at least 2 months apart (none merged away)", () => {
    const r = run("2025-10-16", "2026-03-16", [], { projection: "full" });
    // the three primaries; the booster after them is a projected extra visit
    const primo = r.visitPlan.visits
      .filter((v: any) => v.products.includes("PCV_PRIMOVAX") && v.status !== "PROJECTED")
      .map((v: any) => v.date)
      .sort();
    expect(primo.length).toBe(3);
    for (let i = 1; i < primo.length; i++) expect(days(primo[i - 1], primo[i])).toBeGreaterThanOrEqual(59);
    for (const p of [...datesOf(r, "PENTA"), ...datesOf(r, "DTC"), ...datesOf(r, "TD")]) {
      for (const q of primo) expect(Math.abs(days(p, q))).toBeGreaterThanOrEqual(15);
    }
  });
});

describe("scheduleWithSpacing on its own", () => {
  const spacingPack: any = {
    catalog: { product_groups: [{ id: "A" }, { id: "B" }] },
    spacing: { spacing_rules: [{ id: "R", applies_when: { pairs: [{ product_a: "A", product_b: "B" }] }, min_gap: { days: 15 }, same_day_allowed: false, move_on_tie: "B" }] }
  };
  const visit = (id: string, date: string, order: number) => ({ productGroupId: id, date: parseDate(date), baseDate: parseDate(date), order });
  const noChain = (v: any) => v.baseDate;
  it("same day: the designated product waits", () => {
    const a = visit("A", "2026-01-01", 0), b = visit("B", "2026-01-01", 1);
    scheduleWithSpacing([a, b], [], spacingPack, noChain);
    expect([formatDate(a.date), formatDate(b.date)]).toEqual(["2026-01-01", "2026-01-16"]);
  });
  it("different days: the one due first keeps its date, whichever product it is", () => {
    const a = visit("A", "2026-01-05", 0), b = visit("B", "2026-01-01", 1);
    scheduleWithSpacing([a, b], [], spacingPack, noChain);
    expect([formatDate(a.date), formatDate(b.date)]).toEqual(["2026-01-16", "2026-01-01"]);
  });
  it("a recorded dose never moves", () => {
    const a = visit("A", "2026-01-05", 0);
    scheduleWithSpacing([a], [{ administeredOn: "2026-01-01", productGroupId: "B" }], spacingPack, noChain);
    expect(formatDate(a.date)).toBe("2026-01-16");
  });
  it("moves later only, and a pushed visit drags its same-program successors via the chain", () => {
    const a1 = visit("A", "2026-01-01", 0), b = visit("B", "2026-01-01", 1), a2 = visit("A", "2026-01-20", 2);
    const chain = (v: any) => (v === a2 ? addDurationToDate(a1.date, { days: 28 }) : v.baseDate);
    scheduleWithSpacing([a1, b, a2], [], spacingPack, chain);
    expect(formatDate(b.date)).toBe("2026-01-16");
    expect(formatDate(a2.date)).toBe("2026-01-31"); // 28 days after a1 is 01-29, but B at 01-16 needs 15 days: 01-31
  });
});

describe("intervals are measured in calendar months, like the planner", () => {
  it("vitamin D: 6 months after Jan 31 is Jul 31", () => {
    const ok = run("2026-01-01", "2026-08-05", [{ administeredOn: "2026-01-31", productGroupId: "VITD" }, { administeredOn: "2026-07-31", productGroupId: "VITD" }]);
    const early = run("2026-01-01", "2026-08-05", [{ administeredOn: "2026-01-31", productGroupId: "VITD" }, { administeredOn: "2026-07-30", productGroupId: "VITD" }]);
    expect(ok.doseValidations.VITD_DOSES.doses[1].valid).toBe(true);
    expect(early.doseValidations.VITD_DOSES.doses[1].reasons).toContain("INVALID_INTERVAL_BEFORE_DOSE_2");
  });
  it("hepatitis B: 1 month after Feb 11 is Mar 11", () => {
    const hb = (d2: string) => run("2018-01-01", "2018-04-01", [{ administeredOn: "2018-02-11", productGroupId: "HB_MONO" }, { administeredOn: d2, productGroupId: "HB_MONO" }]).doseValidations.HB_DOSES.doses[1];
    expect(hb("2018-03-11").valid).toBe(true);
    expect(hb("2018-03-10").reasons).toContain("INVALID_INTERVAL_BEFORE_DOSE_2");
  });
});

describe("the plan is valid when recorded as given (children with no history)", () => {
  const live: Record<string, boolean> = { VPO: true, ROTAVIRUS: true, RR: true, RRO: true, VAR: true };
  const dtp = new Set(["PENTA", "DTC", "TD"]);
  it("every planned dose validates and every spacing rule holds, for 12 birth dates x 10 ages", () => {
    const problems: string[] = [];
    const ages = [0, 1, 2, 2.5, 3, 5, 7, 12, 24, 60];
    for (let b = 0; b < 12; b++) {
      const birth = formatDate(addDurationToDate(parseDate("2024-01-01"), { days: b * 23 }));
      for (const m of ages) {
        const ev = formatDate(addDurationToDate(parseDate(birth), { days: Math.round(m * 30.44) }));
        const r = run(birth, ev);
        const planned = r.visitPlan.visits.flatMap((v: any) => v.products.map((p: string) => ({ administeredOn: v.date, productGroupId: p })));
        if (planned.length) {
          const last = planned.map((x: any) => x.administeredOn).sort().pop()!;
          const r2 = run(birth, last, planned);
          for (const [c, v] of Object.entries<any>(r2.doseValidations)) for (const d of v.doses) {
            if (!d.valid) problems.push(`${birth}@${ev} ${c} ${d.productGroupId} ${d.administeredOn} ${d.reasons.join(",")}`);
          }
        }
        for (const x of planned) for (const y of planned) {
          if (x.administeredOn >= y.administeredOn) continue;
          const gap = days(x.administeredOn, y.administeredOn);
          const primoVsDtp = (x.productGroupId === "PCV_PRIMOVAX" && dtp.has(y.productGroupId)) || (y.productGroupId === "PCV_PRIMOVAX" && dtp.has(x.productGroupId));
          if (primoVsDtp && gap < 15) problems.push(`${birth}@${ev} PRIMOVAX offset ${x.productGroupId} ${y.productGroupId} gap ${gap}`);
          const liveLive = live[x.productGroupId] && live[y.productGroupId];
          const exempt = [x.productGroupId, y.productGroupId].sort().join() === "ROTAVIRUS,VPO";
          if (liveLive && !exempt && gap < 28) problems.push(`${birth}@${ev} live gap ${x.productGroupId} ${y.productGroupId} ${gap}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

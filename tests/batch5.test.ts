// Batch 5: projection (PCV booster, labels, spacing for projected visits), Rota age limit, cluster delay.
// Expects ./src next to ./test and the pack in ./schedule-packs (run from the project root).
import { describe, it, expect } from "vitest";

const root = process.env.ENGINE_SRC ?? "../src";
const { loadSchedulePack } = await import(`${root}/loader`);
const { evaluatePatient } = await import(`${root}/engine`);
const { parseDate, formatDate, addDurationToDate } = await import(`${root}/engine/duration`);

const pack = loadSchedulePack("MA");
const run = (birth: string, on: string, history: any[] = [], opts: any = {}) =>
  evaluatePatient({ birthDate: birth }, history, pack, parseDate(on), opts);
const days = (a: string, b: string) => Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
const visitsWith = (r: any, product: string) => r.visitPlan.visits.filter((v: any) => v.products.includes(product));

describe("full projection", () => {
  const newborn = run("2026-01-01", "2026-01-10", [], { projection: "full" });

  it("projects the PCV booster after the three primaries", () => {
    const primo = visitsWith(newborn, "PCV_PRIMOVAX");
    expect(primo.filter((v: any) => v.status !== "PROJECTED").length).toBe(3);
    const booster = primo.find((v: any) => v.status === "PROJECTED");
    expect(booster).toBeTruthy();
    expect(booster.doses.find((d: any) => d.programId === "PCV_PROGRAM").projected).toBe(true);
    const third = primo.filter((v: any) => v.status !== "PROJECTED").map((v: any) => v.date).sort().pop()!;
    expect(booster.date >= formatDate(addDurationToDate(parseDate(third), { months: 6 }))).toBe(true);
  });
  it("projects no PCV booster on a track that has none (15 months, nothing given)", () => {
    const r = run("2025-01-01", "2026-04-01", [], { projection: "full" });
    const primo = visitsWith(r, "PCV_PRIMOVAX");
    expect(primo.length).toBe(2);
    expect(primo.some((v: any) => v.status === "PROJECTED")).toBe(false);
  });
  it("a day with a real dose and a projected booster is not labelled PROJECTED", () => {
    const v = newborn.visitPlan.visits.find((x: any) => x.date === "2027-07-01");
    expect(v.status).toBe("DUE_FUTURE");
    const rr = v.doses.find((d: any) => d.programId === "RR_PROGRAM");
    const dtp = v.doses.find((d: any) => d.programId === "DTP_PROGRAM");
    expect(rr.projected).toBeUndefined();
    expect(dtp.projected).toBe(true);
  });
  it("projected boosters keep their intervals when earlier doses are moved (12-month child, DTC booster)", () => {
    const r = run("2024-02-06", "2025-02-05", [], { projection: "full" });
    const pentas = visitsWith(r, "PENTA").map((v: any) => v.date).sort();
    const booster = visitsWith(r, "DTC").find((v: any) => v.status === "PROJECTED");
    expect(booster).toBeTruthy();
    expect(booster.date >= formatDate(addDurationToDate(parseDate(pentas[pentas.length - 1]), { months: 6 }))).toBe(true);
  });
});

describe("full plans are valid and spaced, projected visits included (children with no history)", () => {
  const live: Record<string, boolean> = { VPO: true, ROTAVIRUS: true, RR: true, RRO: true, VAR: true };
  const dtp = new Set(["PENTA", "DTC", "TD"]);
  it("12 birth dates x 10 ages", () => {
    const problems: string[] = [];
    const ages = [0, 1, 2, 2.5, 3, 5, 7, 12, 24, 60];
    for (let b = 0; b < 12; b++) {
      const birth = formatDate(addDurationToDate(parseDate("2024-01-01"), { days: b * 23 + 5 }));
      for (const m of ages) {
        const ev = formatDate(addDurationToDate(parseDate(birth), { days: Math.round(m * 30.44) }));
        const r = run(birth, ev, [], { projection: "full" });
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
          const exempt = [x.productGroupId, y.productGroupId].sort().join() === "ROTAVIRUS,VPO";
          if (live[x.productGroupId] && live[y.productGroupId] && !exempt && gap < 28) problems.push(`${birth}@${ev} live gap ${x.productGroupId} ${y.productGroupId} ${gap}`);
        }
        // two doses of the same program are never planned a few days apart (a projected booster next to a real dose)
        const byProgram: Record<string, string[]> = {};
        for (const v of r.visitPlan.visits) for (const d of v.doses) if (d.doseNumber > 0) (byProgram[d.programId] ??= []).push(v.date);
        for (const [prog, ds] of Object.entries(byProgram)) {
          const sorted = [...ds].sort();
          for (let i = 1; i < sorted.length; i++) if (days(sorted[i - 1], sorted[i]) < 21 && prog !== "PCV_PROGRAM") problems.push(`${birth}@${ev} ${prog} doses ${sorted[i - 1]} and ${sorted[i]}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("Rota age limit holds on the final dates", () => {
  it("no Rota dose is planned on or after the 24-month birthday (sweep around the limit)", () => {
    const bad: string[] = [];
    for (let b = 0; b < 6; b++) {
      const birth = formatDate(addDurationToDate(parseDate("2024-03-01"), { days: b * 17 }));
      const limit = formatDate(addDurationToDate(parseDate(birth), { months: 24 }));
      for (let d = -75; d <= 3; d++) {
        const ev = formatDate(addDurationToDate(parseDate(limit), { days: d }));
        const r = run(birth, ev, [], { projection: "full" });
        for (const v of visitsWith(r, "ROTAVIRUS")) if (v.date >= limit) bad.push(`${birth} eval ${ev}: rota ${v.date} (limit ${limit})`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("a late starter gets only the doses that fit, with a warning", () => {
    const r = run("2024-04-01", "2026-03-25");
    expect(visitsWith(r, "ROTAVIRUS").length).toBe(1);
    expect(r.visitPlan.warnings.some((w: string) => w.startsWith("AGE_LIMIT_PREVENTS_DOSE: ROTA_PROGRAM"))).toBe(true);
  });
});

describe("visit alignment never delays a dose more than the configured maximum", () => {
  it("vitamin A due 2023-06-22 is not pulled to 2023-07-07 by a chain of nearby doses", () => {
    const r = run("2022-12-22", "2023-06-09", [
      { administeredOn: "2023-05-12", productGroupId: "TD" },
      { administeredOn: "2023-06-09", productGroupId: "VITA" },
      { administeredOn: "2023-04-19", productGroupId: "PCV_PRIMOVAX" },
      { administeredOn: "2022-12-31", productGroupId: "VITA" },
      { administeredOn: "2023-06-09", productGroupId: "ROTAVIRUS" },
      { administeredOn: "2023-06-09", productGroupId: "PCV_PREVENAR" },
      { administeredOn: "2023-06-09", productGroupId: "ROTAVIRUS" }
    ]);
    const vita = visitsWith(r, "VITA")[0];
    expect(vita.date).toBe("2023-06-22");
  });
});

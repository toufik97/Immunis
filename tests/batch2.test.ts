// Batch 2: VPO0 re-plan, fail-closed rule matching, load-time pack validation, small fixes.
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
const evalAt = (birth: string, on: string, history: any[] = [], p: any = pack, opts: any = {}) =>
  evaluatePatient({ birthDate: birth }, history, p, parseDate(on), opts);
const need = (r: any, program: string) => r.antigenNeeds.find((n: any) => n.programId === program);
const birthPlan = (r: any, program: string) =>
  r.productSelection.birthDosePlans.some((b: any) => b.programId === program);

describe("VPO0 is not planned again once given", () => {
  it("plans VPO0 for a newborn with no history", () => {
    expect(birthPlan(evalAt("2026-01-01", "2026-01-10"), "VPO_PROGRAM")).toBe(true);
  });
  it("does not plan it when VPO0 is already recorded", () => {
    const r = evalAt("2026-01-01", "2026-01-10", [{ administeredOn: "2026-01-02", productGroupId: "VPO" }]);
    expect(birthPlan(r, "VPO_PROGRAM")).toBe(false);
    expect(r.visitPlan.visits.some((v: any) => v.date <= "2026-01-31" && v.products.includes("VPO"))).toBe(false);
  });
  it("still plans VPO dose 1 at 2 months after VPO0", () => {
    const r = evalAt("2026-01-01", "2026-01-10", [{ administeredOn: "2026-01-02", productGroupId: "VPO" }]);
    expect(r.visitPlan.visits.some((v: any) => v.date === "2026-03-01" && v.products.includes("VPO"))).toBe(true);
  });
  it("regression: HB birth dose recorded is not planned again, not recorded is", () => {
    expect(birthPlan(evalAt("2026-01-01", "2026-01-10", [{ administeredOn: "2026-01-02", productGroupId: "HB_MONO" }]), "HB_PROGRAM")).toBe(false);
    expect(birthPlan(evalAt("2026-01-01", "2026-01-10"), "HB_PROGRAM")).toBe(true);
  });
});

describe("no matching rule fails closed", () => {
  it("returns UNDETERMINED, not NOT_NEEDED, and plans nothing for that program", () => {
    const broken: any = structuredClone(pack);
    broken.programs.BCG_PROGRAM.catchup_rules = broken.programs.BCG_PROGRAM.catchup_rules.filter(
      (r: any) => r.id === "MA-BCG-CU-GE6Y"
    );
    const r = evalAt("2024-01-01", "2026-04-01", [], broken);
    const n = need(r, "BCG_PROGRAM");
    expect(n.status).toBe("UNDETERMINED");
    expect(n.warnings.some((w: string) => w.startsWith("NO_MATCHING_RULE"))).toBe(true);
    expect(r.visitPlan.visits.some((v: any) => v.products.includes("BCG"))).toBe(false);
  });
  it("an unknown action is UNDETERMINED too", () => {
    const broken: any = structuredClone(pack);
    broken.programs.BCG_PROGRAM.catchup_rules[0].then.action = "bogus";
    const n = need(evalAt("2026-03-01", "2026-04-01", [], broken), "BCG_PROGRAM");
    expect(n.status).toBe("UNDETERMINED");
  });
  it("the real pack leaves no program undetermined across ages 0-20 and history sizes", () => {
    const products = ["PENTA", "VPO", "HB_MONO", "BCG", "RR", "PCV_PRIMOVAX", "PCV_PREVENAR", "ROTAVIRUS", "VPI", "DTC", "TD"];
    const bad: string[] = [];
    for (let months = 0; months <= 240; months += 3) {
      const birth = "2000-01-01";
      const d = new Date(2000, 0, 1); d.setMonth(d.getMonth() + months);
      const on = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      for (let k = 0; k <= 4; k++) {
        const history = products.slice(0, 6).flatMap((p, i) => Array.from({ length: k }, (_, j) => {
          const x = new Date(2000, 0, 1); x.setMonth(x.getMonth() + Math.min(months, 3 + i * 2 + j * 2));
          return { administeredOn: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-01`, productGroupId: p };
        }));
        const r = evalAt(birth, on, history);
        for (const n of r.antigenNeeds) if (n.status === "UNDETERMINED") bad.push(`${on} k=${k} ${n.programId}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("pack validation at load time", () => {
  const here = path.resolve(process.cwd(), "schedule-packs");
  function mutated(file: string, from: string | RegExp, to: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-"));
    fs.cpSync(here, dir, { recursive: true, dereference: true });
    const p = path.join(dir, "MA", file);
    const before = fs.readFileSync(p, "utf8");
    const after = before.replace(from, to);
    expect(after).not.toBe(before); // the mutation must actually change something
    fs.writeFileSync(p, after);
    return dir;
  }
  const load = (dir: string) => () => loadSchedulePack("MA", dir);

  it("the real pack loads", () => {
    expect(() => loadSchedulePack("MA")).not.toThrow();
  });
  it("rejects a mistyped condition key", () => {
    expect(load(mutated("programs/bcg.yaml", "      age: { to_before: { years: 1 } }", "      agee: { to_before: { years: 1 } }"))).toThrow(/agee/);
  });
  it("rejects a mistyped action", () => {
    expect(load(mutated("programs/bcg.yaml", "action: none", "action: nonee"))).toThrow();
  });
  it("rejects a mistyped duration key", () => {
    expect(load(mutated("programs/bcg.yaml", "to_before: { years: 1 }", "to_before: { year: 1 }"))).toThrow(/year/);
  });
  it("rejects an unknown product in product_history", () => {
    expect(load(mutated("programs/pcv.yaml", "PCV_PRIMOVAX: { gte: 1 }", "PCV_PRIMOVAXX: { gte: 1 }"))).toThrow(/PCV_PRIMOVAXX/);
  });
  it("rejects a rule whose counter is not the program's counter", () => {
    expect(load(mutated("programs/bcg.yaml", "counter: { id: BCG_DOSES, equals: 0 }", "counter: { id: BCG_DOSE, equals: 0 }"))).toThrow(/can never match/);
  });
  it("rejects an unknown booster policy", () => {
    expect(load(mutated("programs/dt.yaml", "booster_policy: DT_BOOSTERS", "booster_policy: DT_BOOSTER"))).toThrow(/DT_BOOSTER/);
  });
  it("rejects an unknown product in spacing rules", () => {
    expect(load(mutated("spacing.yaml", /(move(_on_tie)?: )PCV_PRIMOVAX/, "$1PCV_PRIMOVAXX"))).toThrow(/PCV_PRIMOVAXX/);
  });
});

describe("small fixes", () => {
  it("dose cap: status COMPLETE, action complete, message names the real age limit", () => {
    const history = [
      ["2020-03-01", "PENTA"], ["2020-04-01", "PENTA"], ["2020-05-01", "PENTA"],
      ["2021-07-01", "DTC"], ["2025-03-01", "TD"], ["2025-09-01", "TD"]
    ].map(([administeredOn, productGroupId]) => ({ administeredOn, productGroupId }));
    // 4 DTP-containing doses (booster 2 would be due) but 6 DT-containing doses before 7 years: the cap wins
    const n = need(evalAt("2020-01-01", "2026-06-01", history), "DTP_PROGRAM");
    expect(n.status).toBe("COMPLETE");
    expect(n.action).toBe("complete");
    expect(n.warnings.some((w: string) => w.startsWith("DOSE_CAP_REACHED_PLANNING_STOPPED") && w.includes("before 7 years"))).toBe(true);
  });
  it("BCG: a recorded dose at 6 years or older is COMPLETE, no dose is NOT_NEEDED", () => {
    expect(need(evalAt("2018-01-01", "2026-06-01", [{ administeredOn: "2018-01-05", productGroupId: "BCG" }]), "BCG_PROGRAM").status).toBe("COMPLETE");
    expect(need(evalAt("2018-01-01", "2026-06-01"), "BCG_PROGRAM").status).toBe("NOT_NEEDED");
  });
  it("conditional booster products are described, not printed as [object Object]", () => {
    const r = evalAt("2020-01-01", "2021-09-01", [
      { administeredOn: "2020-03-01", productGroupId: "PENTA" },
      { administeredOn: "2020-04-01", productGroupId: "PENTA" },
      { administeredOn: "2020-05-01", productGroupId: "PENTA" }
    ]);
    expect(r.productSelection.reasoning.join("\n")).not.toContain("[object Object]");
  });
});

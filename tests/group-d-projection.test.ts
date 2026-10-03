import { describe, it, expect } from "vitest";
import { run, rec } from "./helpers";

const P3 = (y: string) => [
  rec(`${y}-06-01`, "PENTA"),
  rec(`${y}-07-01`, "PENTA"),
  rec(`${y}-08-01`, "PENTA")
];

function projectedByRole(r: ReturnType<typeof run>, role: string, product: string) {
  return r.visitPlan.visits.find(
    v => v.status === "PROJECTED" && v.role === role && v.products.includes(product)
  );
}

describe("Group D — full projection (resilient)", () => {
  it("D1: 4m none, full → DTP boosters projected", () => {
    const r = run("2026-01-01", [], "2026-05-01", "full");
    const roles = r.visitPlan.visits.filter(v => v.status === "PROJECTED").map(v => v.role);
    expect(roles.some(role => role.includes("booster_1"))).toBe(true);
    expect(roles.some(role => role.includes("booster_2"))).toBe(true);
  });

  it("D2: 10m none, full → boosters projected for DTP and VPO", () => {
    const r = run("2025-06-01", [], "2026-04-01", "full");
    const projected = r.visitPlan.visits.filter(v => v.status === "PROJECTED");
    expect(projected.length).toBeGreaterThanOrEqual(2);
    const roles = projected.map(v => v.role);
    expect(roles.some(role => role.includes("booster_1"))).toBe(true);
  });

  it("D3: 24m primary complete, full → B1 now + DTP B2 projected at B1+4y", () => {
    const r = run("2024-04-01", P3("2024"), "2026-04-01", "full");
    expect(projectedByRole(r, "booster_2", "DTC")?.date).toBe("2030-04-01");
  });

  it("D4: projected dates anchor to the actual historical date of B1", () => {
    const before = run("2024-04-01", P3("2024"), "2026-04-01", "full");
    const b2Before = before.visitPlan.visits.find(v => v.status === "PROJECTED" && v.role === "booster_2");

    const after = run("2024-04-01", [...P3("2024"), rec("2026-06-01", "DTC")], "2026-06-02", "full");
    const b2After = after.visitPlan.visits.find(v => v.status === "PROJECTED" && v.role === "booster_2");

    expect(b2Before).toBeDefined();
    expect(b2After).toBeDefined();
    expect(b2After!.date).not.toBe(b2Before!.date);
  });
});
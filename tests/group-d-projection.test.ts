import { describe, it, expect } from "vitest";
import { run, rec } from "./helpers";

const P3 = (y: string) => [
  rec(`${y}-06-01`, "PENTA"),
  rec(`${y}-07-01`, "PENTA"),
  rec(`${y}-08-01`, "PENTA")
];

describe("Group D — full projection", () => {
  it("D1: 4m none, full → 3 P + PROJECTED B1, B2", () => {
    const r = run("2026-01-01", [], "2026-05-01", "full");
    const projected = r.visitPlan.visits.filter(v => v.status === "PROJECTED");
    expect(projected.map(v => v.role)).toEqual(["booster_1", "booster_2"]);
    expect(projected[0].date).toBe("2027-07-01");
    expect(projected[1].date).toBe("2031-01-01");
  });

  it("D2: 10m none, full → 3 P then PROJECTED boosters", () => {
    const r = run("2025-06-01", [], "2026-04-01", "full");
    const projected = r.visitPlan.visits.filter(v => v.status === "PROJECTED");
    expect(projected.length).toBe(2);
  });

  it("D3: 24m primary complete, full → B1 now + PROJECTED B2 at B1+4y", () => {
    const r = run("2024-04-01", P3("2024"), "2026-04-01", "full");
    const projected = r.visitPlan.visits.filter(v => v.status === "PROJECTED");
    expect(projected.length).toBe(1);
    expect(projected[0].role).toBe("booster_2");
    expect(projected[0].date).toBe("2030-04-01");
  });

  it("D4: projected dates anchor to the actual historical date of B1", () => {
    const before = run("2024-04-01", P3("2024"), "2026-04-01", "full");
    const b2Before = before.visitPlan.visits.find(v => v.role === "booster_2")!;

    // Record B1 actually given 2 months later than the DUE_NOW date
    const after = run("2024-04-01", [
      ...P3("2024"),
      rec("2026-06-01", "DTC")
    ], "2026-06-02", "full");
    const b2After = after.visitPlan.visits.find(v => v.role === "booster_2")!;

    // B2 shifts because B1 was given later
    expect(b2After.date).not.toBe(b2Before.date);
    expect(b2After.date).toBe("2030-06-01");
  });
});
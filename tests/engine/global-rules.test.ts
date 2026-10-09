import { describe, it, expect } from "vitest";
import { run, doses, count, need, rec } from "./helpers";

const P3 = (y: string) => [
  rec(`${y}-06-01`, "PENTA"),
  rec(`${y}-07-01`, "PENTA"),
  rec(`${y}-08-01`, "PENTA")
];

describe("Global rules G3, G4, G11, G13, G14", () => {
  it("G3: a late dose is never invalid", () => {
    const r = run("2024-01-01", [
      rec("2024-03-01", "PENTA"),
      rec("2025-06-01", "PENTA")
    ], "2025-07-01");
    expect(doses(r, "DTP_CONTAINING_DOSES")[1].valid).toBe(true);
  });

  it("G4: extra doses are harmless extras", () => {
    const r = run("2024-01-01", [
      rec("2024-01-01", "HB_MONO"),
      rec("2024-03-01", "PENTA"),
      rec("2024-04-01", "PENTA"),
      rec("2024-05-01", "PENTA")
    ], "2024-12-01");
    expect(count(r, "HB_DOSES")).toBe(4);
    expect(need(r, "HB_PROGRAM").dosesNeeded).toBe(0);
  });

  it("G11: 4th valid dose is treated as booster 1, 5th as booster 2", () => {
    const four = run("2021-02-01", [...P3("2021"), rec("2022-08-01", "DTC")], "2026-04-01");
    expect(need(four, "DTP_PROGRAM").boosterSequence).toBe(2);

    const five = run("2020-04-01", [
      ...P3("2020"),
      rec("2021-10-01", "DTC"),
      rec("2025-04-01", "DTC")
    ], "2026-04-01");
    expect(need(five, "DTP_PROGRAM").status).toBe("COMPLETE");
  });

  it("G13: three-tier — counted-with-warning vs invalid", () => {
    const warned = run("2024-04-01", [...P3("2024"), rec("2025-06-01", "PENTA")], "2026-04-01");
    expect(doses(warned, "DTP_CONTAINING_DOSES")[3].valid).toBe(true);
    expect(doses(warned, "DTP_CONTAINING_DOSES")[3].warnings.length).toBeGreaterThan(0);

    const invalid = run("2024-04-01", [...P3("2024"), rec("2024-12-01", "DTC")], "2026-04-01");
    expect(doses(invalid, "DTP_CONTAINING_DOSES")[3].valid).toBe(false);
  });

  it("G14: routine window exempt from 4-year booster spacing", () => {
    const routine = run("2021-02-01", [...P3("2021"), rec("2022-08-01", "DTC")], "2026-04-01");
    expect(doses(routine, "DTP_CONTAINING_DOSES")[4 - 1].warnings).toEqual([]);

    const catchup = run("2020-04-01", [
      ...P3("2020"),
      rec("2024-04-01", "DTC"),
      rec("2025-04-01", "DTC")
    ], "2026-04-01");
    expect(doses(catchup, "DTP_CONTAINING_DOSES")[4].valid).toBe(false);
  });
});
import { describe, it } from "vitest";
import { run, expectVisit, rec } from "./helpers";

describe("Group C — conditional intervals", () => {
  it("C1: dose 2 at 11m → dose 3 at 4 weeks", () => {
    const r = run("2025-01-01", [
      rec("2025-03-01", "PENTA"),
      rec("2025-11-01", "PENTA")
    ], "2025-11-15");
    expectVisit(r, 0, "2025-11-29", ["PENTA"], "DUE_FUTURE");
  });

  it("C2: dose 2 at 13m → dose 3 at 6 months (DTC+HB, Hib complete)", () => {
    const r = run("2023-01-01", [
      rec("2024-01-01", "PENTA"),
      rec("2024-02-01", "PENTA")
    ], "2024-03-01");
    // Hib is complete (2 doses > 1 needed for >12m). Penta penalized for unneeded Hib.
    expectVisit(r, 0, "2024-08-01", ["DTC", "HB_MONO"], "DUE_FUTURE");
  });

  it("C3: HB dose 2 at 25m → Penta covers DTP+Hib+HB", () => {
    const r = run("2022-01-01", [
      rec("2022-01-01", "HB_MONO"),
      rec("2024-02-01", "HB_MONO")
    ], "2024-03-01");
    // DTP and Hib are completely unvaccinated, so Penta is chosen to cover all 3
    expectVisit(r, 0, "2024-07-01", ["PENTA"], "DUE_FUTURE");
  });

  it("C4: Hib dose 2 at 4m → dose 3 at 4 months min age", () => {
    const r = run("2025-01-01", [
      rec("2025-03-01", "PENTA"),
      rec("2025-04-01", "PENTA")
    ], "2025-04-10");
    // 4 weeks after April 1 is April 29, but min age for dose 3 is 4 months (May 1)
    expectVisit(r, 0, "2025-05-01", ["PENTA"], "DUE_FUTURE");
  });

  it("C5: Hib dose 2 at 8m → dose 3 (rappel) at 4 weeks", () => {
    const r = run("2025-01-01", [
      rec("2025-03-01", "PENTA"),
      rec("2025-09-01", "PENTA")
    ], "2025-09-10");
    expectVisit(r, 0, "2025-09-29", ["PENTA"], "DUE_FUTURE");
  });
});
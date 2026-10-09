import { describe, it, expect } from "vitest";
import { run, doses, count, need, rec } from "./helpers";

describe("Group E — data quality", () => {
  it("E1: unknown history = unvaccinated", () => {
    const r = run("2026-01-01", [], "2026-05-01");
    expect(need(r, "DTP_PROGRAM").dosesNeeded).toBe(3);
    expect(need(r, "HB_PROGRAM").dosesNeeded).toBe(3);
    expect(need(r, "HIB_PROGRAM").dosesNeeded).toBe(3);
  });

  it("E2: same-day duplicate → 1 valid + 1 invalid DUPLICATE_SAME_DAY", () => {
    const r = run("2024-01-01", [
      rec("2024-03-01", "PENTA"),
      rec("2024-03-01", "PENTA")
    ], "2024-12-01");
    expect(count(r, "DTP_CONTAINING_DOSES")).toBe(1);
    expect(doses(r, "DTP_CONTAINING_DOSES")[1].valid).toBe(false);
    expect(doses(r, "DTP_CONTAINING_DOSES")[1].reasons).toContain("DUPLICATE_SAME_DAY");
  });

  it("E3: unknown product is ignored without crashing", () => {
    const r = run("2024-01-01", [rec("2024-03-01", "NOT_IN_CATALOG")], "2024-12-01");
    expect(count(r, "DTP_CONTAINING_DOSES")).toBe(0);
    expect(count(r, "HB_DOSES")).toBe(0);
  });

  it("E4: foreign DTC-only history evaluated under MA policy", () => {
    const r = run("2024-01-01", [
      rec("2024-03-01", "DTC"),
      rec("2024-04-01", "DTC"),
      rec("2024-05-01", "DTC")
    ], "2026-04-01");
    expect(count(r, "DTP_CONTAINING_DOSES")).toBe(3);
    expect(count(r, "HB_DOSES")).toBe(0);
    expect(need(r, "HB_PROGRAM").dosesNeeded).toBe(3);
  });
});
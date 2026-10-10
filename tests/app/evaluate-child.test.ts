import { describe, it, expect } from "vitest";
import { nextExpectedProducts } from "../../src/app/evaluate-child";

describe("nextExpectedProducts", () => {
  it("returns nothing when no visit is after the recording date", () => {
    expect(nextExpectedProducts({ visitPlan: { visits: [] } }, "2026-01-01")).toEqual([]);
    expect(
      nextExpectedProducts(
        { visitPlan: { visits: [{ date: "2025-01-01", products: ["BCG"], status: "due", projected: false }] } },
        "2026-01-01"
      )
    ).toEqual([]);
  });

  it("returns the first visit after the recording date", () => {
    const result = {
      visitPlan: {
        visits: [
          { date: "2026-02-01", products: ["PENTA"], status: "due", projected: false },
          { date: "2026-03-01", products: ["BCG"], status: "due", projected: false },
        ],
      },
    };
    expect(nextExpectedProducts(result, "2026-01-01")).toEqual(["PENTA"]);
  });
});

import { describe, it, expect } from "vitest";
import { pack } from "./helpers";
import {
  DurationSchema,
  CounterDefSchema,
  DoseCapSchema,
  EligibilityRuleSchema,
  SpacingSchema
} from "../../src/infra/packs/schema";

describe("strict schemas", () => {
  it("rejects singular month typo", () => {
    expect(() => DurationSchema.parse({ month: 2 } as any)).toThrow();
  });
  it("rejects counter typo key", () => {
    expect(() =>
      CounterDefSchema.parse({ id: "X", counts_product_goups: ["PENTA"] } as any)
    ).toThrow();
  });
  it("rejects string max_doses", () => {
    expect(() =>
      DoseCapSchema.parse({ counter: "X", max_doses: "six", before_age: { months: 84 } } as any)
    ).toThrow();
  });
  it("rejects spacing without min_gap", () => {
    expect(() =>
      SpacingSchema.parse({ spacing_rules: [{ id: "R", applies_when: { both_live: true } }] } as any)
    ).toThrow();
  });
  it("rejects eligibility without product_group", () => {
    expect(() => EligibilityRuleSchema.parse({ min_age: { months: 2 } } as any)).toThrow();
  });
  it("real MA pack loads with strict schemas", () => {
    expect(pack.programs["DTP_PROGRAM"]).toBeDefined();
    expect((pack.spacing as any).spacing_rules.length).toBeGreaterThan(0);
  });
});

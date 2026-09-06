import { describe, it, expect } from "vitest";
import { selectDtpCatchupRuleFromPolicy } from "../src/rule-matcher";
import { loadSchedulePack } from "../src/load-schedule-pack";

describe("DTP Rule Matcher", () => {
  // Load the actual YAML policy
  const pack = loadSchedulePack("MA");
  const rules = pack.programs.dtp.catchup_rules;

  it("should select 0 doses < 12m rule for a 10-month-old with 0 doses", () => {
    const rule = selectDtpCatchupRuleFromPolicy(rules, 10, 0);
    expect(rule.id).toBe("MA-DTP-CU-0D-LT12M");
    expect(rule.then.action).toBe("start_protocol");
  });

  it("should select 1 dose 18m-3y rule for a 20-month-old with 1 valid dose", () => {
    const rule = selectDtpCatchupRuleFromPolicy(rules, 20, 1);
    expect(rule.id).toBe("MA-DTP-CU-1D-18M-LT3Y");
  });

  it("should select 3 doses 18m-7y rule for a 20-month-old with 3 valid doses", () => {
    const rule = selectDtpCatchupRuleFromPolicy(rules, 20, 3);
    expect(rule.id).toBe("MA-DTP-CU-3D-18M-LT7Y");
    expect(rule.then.action).toBe("give_if_due");
  });

  it("should return fallback NEEDS_REVIEW for an unmatched case (e.g., 8 years old)", () => {
    // 100 months is > 7 years, which is out of scope for our current DTP catch-up rules
    const rule = selectDtpCatchupRuleFromPolicy(rules, 100, 0);
    expect(rule.id).toBe("MA-DTP-CU-FALLBACK");
    expect(rule.then.action).toBe("needs_review");
  });
});
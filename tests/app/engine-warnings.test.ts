import { describe, it, expect } from "vitest";
import { formatEngineWarning } from "../../app/web/src/engineWarnings";

describe("engine warning localization", () => {
  it("translates bare gate codes", () => {
    expect(formatEngineWarning("DUPLICATE_SAME_DAY", "fr")).toContain("deux fois");
    expect(formatEngineWarning("INVALID_AGE_DOSE_2_TOO_EARLY", "ar")).toContain("السن الأدنى");
    expect(formatEngineWarning("INVALID_INTERVAL_BEFORE_DOSE_3", "en")).toContain("too short");
  });

  it("fills params for counted-with-warning sentences", () => {
    const raw = "EARLY_DOSE_2_COUNTED: administered at 3 months, recommended target 4 months. Dose counted (no restart).";
    expect(formatEngineWarning(raw, "en")).toBe(
      "Dose 2 given at 3 months (target 4 months). Counted, no restart."
    );
    expect(formatEngineWarning(raw, "fr")).toContain("Dose 2 à 3 mois");
    expect(formatEngineWarning(raw, "ar")).toContain("الجرعة 2");
    expect(
      formatEngineWarning("EXTRA_DOSE_COUNTED: dose 5 has no schedule rule. Dose counted as a harmless extra.", "fr")
    ).toContain("Dose 5 hors calendrier");
  });

  it("translates planning warnings and localizes embedded dates", () => {
    expect(
      formatEngineWarning("NO_MATCHING_RULE: No matching catch-up rule for age 14 months and 1 valid doses", "fr")
    ).toContain("14 mois");
    const dup = formatEngineWarning(
      "DUPLICATE_DOSE_SAME_DAY: 2026-03-04 has two doses of the same product for the same program; not merged. Check the plan.",
      "fr"
    );
    expect(dup).not.toContain("2026-03-04");
    expect(dup).toContain("mars");
  });

  it("translates the PCV availability assumption", () => {
    expect(
      formatEngineWarning("PCV availability assumed by policy TRANSITION (stock not connected).", "ar")
    ).toContain("المكورات الرئوية");
  });

  it("translates save-time lot and same-day blocks", () => {
    const lot = "CENTRE dose requires a lot (FR-4.3) — or an active paper-transition grant with reason";
    expect(formatEngineWarning(lot, "en")).toContain("paper-transition pass");
    expect(formatEngineWarning(lot, "fr")).toContain("pass de transition papier");
    expect(formatEngineWarning(lot, "ar")).toContain("تصريح انتقال");
    const sameDay = "CENTRE doses must be recorded the same day — paper transition with a grant for older doses";
    expect(formatEngineWarning(sameDay, "en")).toContain("same day only");
    expect(formatEngineWarning(sameDay, "fr")).toContain("jour même");
    expect(formatEngineWarning(sameDay, "ar")).toContain("نفس اليوم");
  });

  it("translates spacing violations", () => {
    const raw = "SPACING_VIOLATION: PCV_PRIMOVAX too close to PENTA (0 days apart, minimum 15 days).";
    expect(formatEngineWarning(raw, "en")).toBe(
      "PCV_PRIMOVAX too close to PENTA (0 days apart, minimum 15 days)."
    );
    expect(formatEngineWarning(raw, "fr")).toContain("trop proche de PENTA");
    expect(formatEngineWarning(raw, "ar")).toContain("قريب جداً");
  });

  it("falls back to raw English for unknown sentences", () => {
    expect(formatEngineWarning("Program is missing id or counter", "fr")).toBe("Program is missing id or counter");
    expect(formatEngineWarning("", "fr")).toBe("");
  });
});

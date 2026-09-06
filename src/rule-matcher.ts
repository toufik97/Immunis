import type { DtpCatchupRule } from "./dtp-policy-schema";

export function selectDtpCatchupRuleFromPolicy(
  rules: DtpCatchupRule[],
  ageMonths: number,
  validDoses: number
): DtpCatchupRule {
  const rule = rules.find((r) => {
    const ageOk =
      (r.ageFromMonths === undefined || ageMonths >= r.ageFromMonths) &&
      (r.ageToBeforeMonths === undefined || ageMonths < r.ageToBeforeMonths);

    let doseOk = false;

    if (r.validDosesEquals !== undefined) {
      doseOk = validDoses === r.validDosesEquals;
    } else if (r.validDosesGte !== undefined) {
      doseOk = validDoses >= r.validDosesGte;
    }

    return ageOk && doseOk;
  });

  if (!rule) {
    return {
      id: "MA-DTP-CU-FALLBACK",
      labelFr: "Cas DTP non couvert",
      action: {
        type: "needs_review",
        reason: "No matching DTP catch-up rule"
      },
      confidence: "needs_validation"
    };
  }

  return rule;
}
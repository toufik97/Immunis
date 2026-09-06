import type { CatchupRule, Duration } from "./schedule-pack-schema";

function durationToMonths(d?: Duration): number | undefined {
  if (!d) return undefined;
  const years = d.years ?? 0;
  const months = d.months ?? 0;
  const weeks = d.weeks ?? 0;
  const days = d.days ?? 0;
  
  // Convert everything to months for age band comparison
  return years * 12 + months + Math.round(weeks / 4.345) + Math.round(days / 30.4);
}

export function selectDtpCatchupRuleFromPolicy(
  rules: CatchupRule[],
  ageMonths: number,
  validDoses: number
): CatchupRule {
  const rule = rules.find((r) => {
    const ageFrom = r.when.age?.from ? durationToMonths(r.when.age.from) : undefined;
    const ageTo = r.when.age?.to_before ? durationToMonths(r.when.age.to_before) : undefined;

    const ageOk =
      (ageFrom === undefined || ageMonths >= ageFrom) &&
      (ageTo === undefined || ageMonths < ageTo);

    let doseOk = false;
    const counter = r.when.counter;
    
    if (counter.equals !== undefined) {
      doseOk = validDoses === counter.equals;
    } else if (counter.gte !== undefined) {
      doseOk = validDoses >= counter.gte;
    }

    return ageOk && doseOk;
  });

  if (!rule) {
    return {
      id: "MA-DTP-CU-FALLBACK",
      label_fr: "Cas DTP non couvert",
      when: {
        counter: { id: "DTP_CONTAINING_DOSES", equals: -1 } // Dummy to satisfy schema
      },
      then: {
        action: "needs_review"
      },
      confidence: "needs_validation"
    };
  }

  return rule;
}
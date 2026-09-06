import { addMonths, addWeeks, addDays, addYears, format } from "date-fns";

import { parseDate } from "./dates";
import type { Protocol, BoosterPolicy, CatchupRule, Duration } from "./schedule-pack-schema";

export interface PlanContext {
  birthDate: string;
  evaluationDate: Date;
  lastValidDoseDate: string | null;
}

export interface PlanVisit {
  visit: number;
  date: string;
  productGroupId: string;
  role: string;
  labelFr: string;
  status: "DUE_NOW" | "DUE_FUTURE";
}

export interface DtpPlan {
  ruleId: string;
  visits: PlanVisit[];
  warnings: string[];
}

function formatDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function addDuration(date: Date, duration?: Duration): Date {
  if (!duration) return date;
  let result = date;
  if (duration.days) result = addDays(result, duration.days);
  if (duration.weeks) result = addWeeks(result, duration.weeks);
  if (duration.months) result = addMonths(result, duration.months);
  if (duration.years) result = addYears(result, duration.years);
  return result;
}

function latestDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function createVisit(
  visitNumber: number,
  date: Date,
  productGroupId: string,
  role: string,
  labelFr: string,
  evaluationDate: Date
): PlanVisit {
  return {
    visit: visitNumber,
    date: formatDate(date),
    productGroupId,
    role,
    labelFr,
    status: date.getTime() <= evaluationDate.getTime() ? "DUE_NOW" : "DUE_FUTURE"
  };
}

function scheduleProtocol(
  protocol: Protocol,
  startDate: Date,
  birthDate: string,
  evaluationDate: Date,
  boosterPolicy: BoosterPolicy | undefined,
  warnings: string[]
): PlanVisit[] {
  if (protocol.confidence === "needs_validation") {
    warnings.push(`Protocol ${protocol.id} is NEEDS_VALIDATION`);
  }

  const visits: PlanVisit[] = [];
  let previousDate: Date | null = null;
  let lastPrimaryDate: Date | null = null;
  let booster1Date: Date | null = null;

  protocol.steps.forEach((step, index) => {
    const baseDate =
      index === 0 || previousDate === null
        ? startDate
        : addDuration(previousDate, step.min_interval);

    previousDate = baseDate;
    const role = step.role ?? "primary";

    visits.push(
      createVisit(
        visits.length + 1,
        baseDate,
        step.product_group,
        role,
        step.product_group,
        evaluationDate
      )
    );

    if (role === "primary" || role === "primary_completion") {
      lastPrimaryDate = baseDate;
    }
    if (role === "booster_1") {
      booster1Date = baseDate;
    }
  });

  const birth = parseDate(birthDate);

  // Add boosters from policy if not explicitly defined in protocol steps
  if (boosterPolicy && lastPrimaryDate && !booster1Date) {
    const b1MinAge = addDuration(birth, boosterPolicy.booster_1.min_age);
    const b1MinInterval = addDuration(lastPrimaryDate, boosterPolicy.booster_1.min_interval_after_primary_completion);
    const booster1DateCalculated = latestDate(b1MinAge, b1MinInterval);

    visits.push(createVisit(visits.length + 1, booster1DateCalculated, boosterPolicy.booster_1.product_group, "booster_1", "DTC rappel 1", evaluationDate));
    booster1Date = booster1DateCalculated;
  }

  if (boosterPolicy && booster1Date) {
    const b2MinAge = addDuration(birth, boosterPolicy.booster_2.min_age);
    const b2MinInterval = addDuration(booster1Date, boosterPolicy.booster_2.min_interval_after_booster_1);
    const booster2DateCalculated = latestDate(b2MinAge, b2MinInterval);

    visits.push(createVisit(visits.length + 1, booster2DateCalculated, boosterPolicy.booster_2.product_group, "booster_2", "DTC rappel 2", evaluationDate));
  }

  return visits;
}

function scheduleBooster(
  dose: "DTP_BOOSTER_1" | "DTP_BOOSTER_2",
  context: PlanContext,
  boosterPolicy: BoosterPolicy | undefined,
  warnings: string[]
): PlanVisit[] {
  if (!boosterPolicy) {
    warnings.push("Missing booster policy definition.");
    return [];
  }

  const birth = parseDate(context.birthDate);
  const referenceDate = context.lastValidDoseDate ? parseDate(context.lastValidDoseDate) : context.evaluationDate;
  const visits: PlanVisit[] = [];

  if (dose === "DTP_BOOSTER_1") {
    const b1MinAge = addDuration(birth, boosterPolicy.booster_1.min_age);
    const b1MinInterval = addDuration(referenceDate, boosterPolicy.booster_1.min_interval_after_primary_completion);
    const booster1Earliest = latestDate(b1MinAge, b1MinInterval);
    const booster1Date = booster1Earliest.getTime() <= context.evaluationDate.getTime() ? context.evaluationDate : booster1Earliest;

    visits.push(createVisit(1, booster1Date, boosterPolicy.booster_1.product_group, "booster_1", "DTC rappel 1", context.evaluationDate));

    const b2MinAge = addDuration(birth, boosterPolicy.booster_2.min_age);
    const b2MinInterval = addDuration(booster1Date, boosterPolicy.booster_2.min_interval_after_booster_1);
    const booster2Earliest = latestDate(b2MinAge, b2MinInterval);
    const booster2Date = booster2Earliest.getTime() <= context.evaluationDate.getTime() ? context.evaluationDate : booster2Earliest;

    visits.push(createVisit(2, booster2Date, boosterPolicy.booster_2.product_group, "booster_2", "DTC rappel 2", context.evaluationDate));
  }

  if (dose === "DTP_BOOSTER_2") {
    const b2MinAge = addDuration(birth, boosterPolicy.booster_2.min_age);
    const b2MinInterval = addDuration(referenceDate, boosterPolicy.booster_2.min_interval_after_booster_1);
    const booster2Earliest = latestDate(b2MinAge, b2MinInterval);
    const booster2Date = booster2Earliest.getTime() <= context.evaluationDate.getTime() ? context.evaluationDate : booster2Earliest;

    visits.push(createVisit(1, booster2Date, boosterPolicy.booster_2.product_group, "booster_2", "DTC rappel 2", context.evaluationDate));
  }

  return visits;
}

export function buildDtpPlan(
  rule: CatchupRule,
  context: PlanContext,
  protocols: Protocol[],
  boosterPolicies: BoosterPolicy[]
): DtpPlan {
  const warnings: string[] = [];

  if (rule.confidence === "needs_validation") {
    warnings.push(`Rule ${rule.id} is NEEDS_VALIDATION`);
  }

  const action = rule.then;
  const boosterPolicyId = action.booster_policy ?? "STANDARD_DTP_BOOSTERS";
  const boosterPolicy = boosterPolicies.find((b) => b.id === boosterPolicyId);

  switch (action.action) {
    case "start_protocol": {
      const protocol = protocols.find((p) => p.id === action.protocol);
      if (!protocol) {
        warnings.push(`Protocol ${action.protocol} not found in schedule pack.`);
        return { ruleId: rule.id, visits: [], warnings };
      }
      const visits = scheduleProtocol(protocol, context.evaluationDate, context.birthDate, context.evaluationDate, boosterPolicy, warnings);
      return { ruleId: rule.id, visits, warnings };
    }

    case "give_if_due":
    case "schedule_future": {
      const dose = action.dose ?? action.future_dose;
      if (!dose) {
        warnings.push("Missing dose definition for booster action.");
        return { ruleId: rule.id, visits: [], warnings };
      }
      const visits = scheduleBooster(dose, context, boosterPolicy, warnings);
      return { ruleId: rule.id, visits, warnings };
    }

    case "complete": {
      return { ruleId: rule.id, visits: [], warnings };
    }

    case "needs_review": {
      warnings.push("Rule requires manual review.");
      return { ruleId: rule.id, visits: [], warnings };
    }
  }
}
import { addMonths, addWeeks, format } from "date-fns";

import { parseDate } from "./dates";
import { dtpProtocols, type DoseRole } from "./protocols";
import type { DtpCatchupRule } from "./dtp-policy-schema";
import type { ProductGroupId } from "./types";

export interface PlanContext {
  birthDate: string;
  evaluationDate: Date;
  lastValidDoseDate: string | null;
}

export interface PlanVisit {
  visit: number;
  date: string;
  productGroupId: ProductGroupId;
  role: DoseRole;
  labelFr: string;
  status: "DUE_NOW" | "DUE_FUTURE";
}

export interface DtpPlan {
  ruleId: string;
  visits: PlanVisit[];
  warnings: string[];
}

type BoosterDose = "DTP_BOOSTER_1" | "DTP_BOOSTER_2";

function formatDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function addDuration(
  date: Date,
  duration?: {
    weeks?: number;
    months?: number;
  }
): Date {
  let result = date;

  if (duration?.weeks) {
    result = addWeeks(result, duration.weeks);
  }

  if (duration?.months) {
    result = addMonths(result, duration.months);
  }

  return result;
}

function latestDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function createVisit(
  visitNumber: number,
  date: Date,
  productGroupId: ProductGroupId,
  role: DoseRole,
  labelFr: string,
  evaluationDate: Date
): PlanVisit {
  return {
    visit: visitNumber,
    date: formatDate(date),
    productGroupId,
    role,
    labelFr,
    status:
      date.getTime() <= evaluationDate.getTime() ? "DUE_NOW" : "DUE_FUTURE"
  };
}

function scheduleProtocol(
  protocolId: string,
  startDate: Date,
  birthDate: string,
  evaluationDate: Date,
  warnings: string[]
): PlanVisit[] {
  const protocol = dtpProtocols[protocolId];

  if (!protocol) {
    warnings.push(`Protocol not found: ${protocolId}`);
    return [];
  }

  if (protocol.confidence === "needs_validation") {
    warnings.push(`Protocol ${protocolId} is NEEDS_VALIDATION`);
  }

  const visits: PlanVisit[] = [];

  let previousDate: Date | null = null;
  let lastPrimaryDate: Date | null = null;
  let booster1Date: Date | null = null;

  protocol.steps.forEach((step, index) => {
    const baseDate =
      index === 0 || previousDate === null
        ? startDate
        : addDuration(previousDate, step.minInterval);

    previousDate = baseDate;

    visits.push(
      createVisit(
        visits.length + 1,
        baseDate,
        step.productGroupId,
        step.role,
        step.labelFr,
        evaluationDate
      )
    );

    if (step.role === "primary" || step.role === "primary_completion") {
      lastPrimaryDate = baseDate;
    }

    if (step.role === "booster_1") {
      booster1Date = baseDate;
    }
  });

  const birth = parseDate(birthDate);

  if (lastPrimaryDate && !booster1Date) {
    const booster1MinAge = addMonths(birth, 18);
    const booster1MinInterval = addMonths(lastPrimaryDate, 6);

    const booster1DateCalculated = latestDate(
      booster1MinAge,
      booster1MinInterval
    );

    visits.push(
      createVisit(
        visits.length + 1,
        booster1DateCalculated,
        "DTC",
        "booster_1",
        "DTC rappel 1",
        evaluationDate
      )
    );

    booster1Date = booster1DateCalculated;
  }

  if (booster1Date) {
    const booster2MinAge = addMonths(birth, 60);
    const booster2MinInterval = addMonths(booster1Date, 48);

    const booster2DateCalculated = latestDate(
      booster2MinAge,
      booster2MinInterval
    );

    visits.push(
      createVisit(
        visits.length + 1,
        booster2DateCalculated,
        "DTC",
        "booster_2",
        "DTC rappel 2",
        evaluationDate
      )
    );
  }

  return visits;
}

function scheduleBooster(
  dose: BoosterDose,
  context: PlanContext,
  warnings: string[]
): PlanVisit[] {
  const birth = parseDate(context.birthDate);

  if (!context.lastValidDoseDate) {
    warnings.push(
      "Missing last valid dose date. Using evaluation date as reference."
    );
  }

  const referenceDate = context.lastValidDoseDate
    ? parseDate(context.lastValidDoseDate)
    : context.evaluationDate;

  const visits: PlanVisit[] = [];

  if (dose === "DTP_BOOSTER_1") {
    const booster1MinAge = addMonths(birth, 18);
    const booster1MinInterval = addMonths(referenceDate, 6);

    const booster1Earliest = latestDate(
      booster1MinAge,
      booster1MinInterval
    );

    const booster1Date =
      booster1Earliest.getTime() <= context.evaluationDate.getTime()
        ? context.evaluationDate
        : booster1Earliest;

    visits.push(
      createVisit(
        1,
        booster1Date,
        "DTC",
        "booster_1",
        "DTC rappel 1",
        context.evaluationDate
      )
    );

    const booster2MinAge = addMonths(birth, 60);
    const booster2MinInterval = addMonths(booster1Date, 48);

    const booster2Earliest = latestDate(
      booster2MinAge,
      booster2MinInterval
    );

    const booster2Date =
      booster2Earliest.getTime() <= context.evaluationDate.getTime()
        ? context.evaluationDate
        : booster2Earliest;

    visits.push(
      createVisit(
        2,
        booster2Date,
        "DTC",
        "booster_2",
        "DTC rappel 2",
        context.evaluationDate
      )
    );
  }

  if (dose === "DTP_BOOSTER_2") {
    const booster2MinAge = addMonths(birth, 60);
    const booster2MinInterval = addMonths(referenceDate, 48);

    const booster2Earliest = latestDate(
      booster2MinAge,
      booster2MinInterval
    );

    const booster2Date =
      booster2Earliest.getTime() <= context.evaluationDate.getTime()
        ? context.evaluationDate
        : booster2Earliest;

    visits.push(
      createVisit(
        1,
        booster2Date,
        "DTC",
        "booster_2",
        "DTC rappel 2",
        context.evaluationDate
      )
    );
  }

  return visits;
}

export function buildDtpPlan(
  rule: DtpCatchupRule,
  context: PlanContext
): DtpPlan {
  const warnings: string[] = [];

  if (rule.confidence === "needs_validation") {
    warnings.push(`Rule ${rule.id} is NEEDS_VALIDATION`);
  }

  const action = rule.action;

  switch (action.type) {
    case "start_protocol": {
      const visits = scheduleProtocol(
        action.protocol,
        context.evaluationDate,
        context.birthDate,
        context.evaluationDate,
        warnings
      );

      return {
        ruleId: rule.id,
        visits,
        warnings
      };
    }

    case "give_if_due": {
      const visits = scheduleBooster(action.dose, context, warnings);

      return {
        ruleId: rule.id,
        visits,
        warnings
      };
    }

    case "schedule_future": {
      const visits = scheduleBooster(action.futureDose, context, warnings);

      return {
        ruleId: rule.id,
        visits,
        warnings
      };
    }

    case "complete": {
      return {
        ruleId: rule.id,
        visits: [],
        warnings
      };
    }

    case "needs_review": {
      warnings.push(action.reason);

      return {
        ruleId: rule.id,
        visits: [],
        warnings
      };
    }
  }
}
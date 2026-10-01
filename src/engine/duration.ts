import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  differenceInMonths
} from "date-fns";

export interface Duration {
  days?: number;
  weeks?: number;
  months?: number;
  years?: number;
  birth?: boolean;
  exclusive?: boolean;
  [key: string]: any;
}

export function parseDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDurationToDate(date: Date, duration?: Duration | null): Date {
  if (!duration) {
    return date;
  }

  let result = date;

  if (duration.days) {
    result = addDays(result, duration.days);
  }
  if (duration.weeks) {
    result = addWeeks(result, duration.weeks);
  }
  if (duration.months) {
    result = addMonths(result, duration.months);
  }
  if (duration.years) {
    result = addYears(result, duration.years);
  }

  return result;
}

export function durationToMonths(duration?: Duration | null): number {
  if (!duration) {
    return 0;
  }
  if (duration.birth) {
    return 0;
  }

  let months = 0;
  if (duration.days) months += duration.days / 30.44;
  if (duration.weeks) months += duration.weeks / 4.345;
  if (duration.months) months += duration.months;
  if (duration.years) months += duration.years * 12;
  return Math.round(months * 10) / 10;
}

export function durationToDays(duration?: Duration | null): number {
  if (!duration) {
    return 0;
  }
  if (duration.birth) {
    return 0;
  }

  let days = 0;
  if (duration.days) days += duration.days;
  if (duration.weeks) days += duration.weeks * 7;
  if (duration.months) days += Math.round(duration.months * 30.44);
  if (duration.years) days += Math.round(duration.years * 365.25);
  return days;
}

export function ageInMonthsAt(birthDate: Date, evaluationDate: Date): number {
  return differenceInMonths(evaluationDate, birthDate);
}

export function resolveDuration(
  rule: any,
  contextAgeMonths: number
): Duration | null {
  if (!rule) {
    return null;
  }

  if (!rule.conditional) {
    return rule as Duration;
  }

  for (const condition of rule.conditional) {
    const ageCondition = condition?.when?.age_at_previous_dose;

    if (!ageCondition) {
      continue;
    }

    // AND-logic: both bounds must hold for a branch to match
    let matches = true;

    if (ageCondition.from) {
      const limit = durationToMonths(ageCondition.from);
      if (contextAgeMonths < limit) {
        matches = false;
      }
    }

    if (ageCondition.to_before) {
      const limit = durationToMonths(ageCondition.to_before);
      if (contextAgeMonths >= limit) {
        matches = false;
      }
    }

    if (matches) {
      return condition.interval as Duration;
    }
  }

  return null;
}
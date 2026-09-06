import {
  differenceInCalendarDays,
  differenceInMonths,
  parseISO
} from "date-fns";

export function parseDate(value: string): Date {
  const date = parseISO(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }

  return date;
}

export function ageInMonthsAt(
  birthDate: string,
  evaluationDate: Date
): number {
  return differenceInMonths(evaluationDate, parseDate(birthDate));
}

export function daysBetween(fromDate: string, toDate: string): number {
  return differenceInCalendarDays(parseDate(toDate), parseDate(fromDate));
}

export function monthsBetween(fromDate: string, toDate: string): number {
  return differenceInMonths(parseDate(toDate), parseDate(fromDate));
}
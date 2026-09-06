import { differenceInCalendarDays, differenceInMonths } from "date-fns";
import { parseDate } from "./dates";
import type { ImmunizationRecord, ProductGroupId } from "./types";
import type { Validity } from "./schedule-pack-schema";

export interface DoseValidityResult {
  administeredOn: string;
  productGroupId: ProductGroupId;
  doseNumber: number;
  valid: boolean;
  reasons: string[];
}

const DTP_PRODUCTS: ProductGroupId[] = ["PENTA", "DTC"];

function durationToMonths(d: any): number {
  if (!d) return 0;
  return (d.years ?? 0) * 12 + (d.months ?? 0) + Math.round((d.weeks ?? 0) / 4.345) + Math.round((d.days ?? 0) / 30.4);
}

function durationToDays(d: any): number {
  if (!d) return 0;
  return (d.years ?? 0) * 365.25 + (d.months ?? 0) * 30.4375 + (d.weeks ?? 0) * 7 + (d.days ?? 0);
}

export function evaluateDtpDoses(
  records: ImmunizationRecord[],
  birthDate: string,
  validity: Validity
): DoseValidityResult[] {
  const dtpRecords = records
    .filter((record) => DTP_PRODUCTS.includes(record.productGroupId))
    .sort(
      (a, b) => parseDate(a.administeredOn).getTime() - parseDate(b.administeredOn).getTime()
    );

  const results: DoseValidityResult[] = [];
  let validDoseCount = 0;
  let lastValidDate: string | null = null;

  const primaryMinIntervalDays = durationToDays(validity.primary.min_interval);

  for (const record of dtpRecords) {
    const reasons: string[] = [];
    const doseNumber = validDoseCount + 1;
    const administeredDate = parseDate(record.administeredOn);
    const ageMonths = differenceInMonths(administeredDate, parseDate(birthDate));

    if (ageMonths < 0) {
      reasons.push("INVALID_DATE_BEFORE_BIRTH");
    }

    // Primary doses (1, 2, 3)
    if (doseNumber <= 3) {
      const minAgeRule = validity.primary.min_ages.find((m) => m.dose === doseNumber);
      const minAgeMonths = minAgeRule ? durationToMonths(minAgeRule) : 0;
      
      if (ageMonths < minAgeMonths) {
        reasons.push(`INVALID_AGE_DOSE_${doseNumber}_TOO_EARLY`);
      }

      if (lastValidDate) {
        const interval = differenceInCalendarDays(administeredDate, parseDate(lastValidDate));
        if (interval < primaryMinIntervalDays) {
          reasons.push(`INVALID_INTERVAL_BEFORE_DOSE_${doseNumber}`);
        }
      }
    }

    // Boosters (4, 5)
    if (doseNumber === 4 || doseNumber === 5) {
      const boosterRule = validity.boosters.find((b) => b.dose === doseNumber);
      if (boosterRule) {
        const minAgeMonths = durationToMonths(boosterRule.min_age);
        const minIntervalMonths = durationToMonths(boosterRule.min_interval);

        if (ageMonths < minAgeMonths) {
          reasons.push(`INVALID_AGE_BOOSTER_${doseNumber - 3}_TOO_EARLY`);
        }

        if (lastValidDate) {
          const interval = differenceInMonths(administeredDate, parseDate(lastValidDate));
          if (interval < minIntervalMonths) {
            reasons.push(`INVALID_INTERVAL_BEFORE_BOOSTER_${doseNumber - 3}`);
          }
        }
      }
    }

    if (doseNumber > 5) {
      reasons.push("NEEDS_REVIEW_MORE_THAN_5_DTP_DOSES");
    }

    const valid = reasons.length === 0;
    if (valid) {
      validDoseCount += 1;
      lastValidDate = record.administeredOn;
    }

    results.push({
      administeredOn: record.administeredOn,
      productGroupId: record.productGroupId,
      doseNumber,
      valid,
      reasons
    });
  }

  return results;
}
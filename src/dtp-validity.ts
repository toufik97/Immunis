import {
  ageInMonthsAt,
  daysBetween,
  monthsBetween,
  parseDate
} from "./dates";

import type { ImmunizationRecord, ProductGroupId } from "./types";

export interface DoseValidityResult {
  administeredOn: string;
  productGroupId: ProductGroupId;
  doseNumber: number;
  valid: boolean;
  reasons: string[];
}

const DTP_PRODUCTS: ProductGroupId[] = ["PENTA", "DTC"];

/**
 * Simplified MVP validity rules.
 *
 * Official Moroccan rules are more complex and some parts still need validation.
 * For now we use:
 *
 * Primary series:
 * - Dose 1 minimum age: 2 months
 * - Dose 2 minimum age: 3 months
 * - Dose 3 minimum age: 4 months
 * - Minimum interval between primary doses: 28 days
 *
 * Booster 1:
 * - Minimum age: 18 months
 * - Minimum interval after primary series: 6 months
 *
 * Booster 2:
 * - Minimum age: 5 years = 60 months
 * - Minimum interval after booster 1: 4 years = 48 months
 */

const PRIMARY_MIN_AGE_MONTHS: Record<number, number> = {
  1: 2,
  2: 3,
  3: 4
};

const PRIMARY_MIN_INTERVAL_DAYS = 28;

const BOOSTER_1_MIN_AGE_MONTHS = 18;
const BOOSTER_1_MIN_INTERVAL_MONTHS = 6;

const BOOSTER_2_MIN_AGE_MONTHS = 60;
const BOOSTER_2_MIN_INTERVAL_MONTHS = 48;

export function evaluateDtpDoses(
  records: ImmunizationRecord[],
  birthDate: string
): DoseValidityResult[] {
  const dtpRecords = records
    .filter((record) => DTP_PRODUCTS.includes(record.productGroupId))
    .sort(
      (a, b) =>
        parseDate(a.administeredOn).getTime() -
        parseDate(b.administeredOn).getTime()
    );

  const results: DoseValidityResult[] = [];

  let validDoseCount = 0;
  let lastValidDate: string | null = null;

  for (const record of dtpRecords) {
    const reasons: string[] = [];

    const doseNumber = validDoseCount + 1;

    const administeredDate = parseDate(record.administeredOn);

    const ageMonths = ageInMonthsAt(birthDate, administeredDate);

    if (ageMonths < 0) {
      reasons.push("INVALID_DATE_BEFORE_BIRTH");
    }

    if (doseNumber === 1) {
      if (ageMonths < PRIMARY_MIN_AGE_MONTHS[1]) {
        reasons.push("INVALID_AGE_DOSE_1_TOO_EARLY");
      }
    }

    if (doseNumber === 2) {
      if (ageMonths < PRIMARY_MIN_AGE_MONTHS[2]) {
        reasons.push("INVALID_AGE_DOSE_2_TOO_EARLY");
      }

      if (lastValidDate) {
        const interval = daysBetween(lastValidDate, record.administeredOn);

        if (interval < PRIMARY_MIN_INTERVAL_DAYS) {
          reasons.push("INVALID_INTERVAL_BEFORE_DOSE_2");
        }
      }
    }

    if (doseNumber === 3) {
      if (ageMonths < PRIMARY_MIN_AGE_MONTHS[3]) {
        reasons.push("INVALID_AGE_DOSE_3_TOO_EARLY");
      }

      if (lastValidDate) {
        const interval = daysBetween(lastValidDate, record.administeredOn);

        if (interval < PRIMARY_MIN_INTERVAL_DAYS) {
          reasons.push("INVALID_INTERVAL_BEFORE_DOSE_3");
        }
      }
    }

    if (doseNumber === 4) {
      if (ageMonths < BOOSTER_1_MIN_AGE_MONTHS) {
        reasons.push("INVALID_AGE_BOOSTER_1_TOO_EARLY");
      }

      if (lastValidDate) {
        const interval = monthsBetween(lastValidDate, record.administeredOn);

        if (interval < BOOSTER_1_MIN_INTERVAL_MONTHS) {
          reasons.push("INVALID_INTERVAL_BEFORE_BOOSTER_1");
        }
      }
    }

    if (doseNumber === 5) {
      if (ageMonths < BOOSTER_2_MIN_AGE_MONTHS) {
        reasons.push("INVALID_AGE_BOOSTER_2_TOO_EARLY");
      }

      if (lastValidDate) {
        const interval = monthsBetween(lastValidDate, record.administeredOn);

        if (interval < BOOSTER_2_MIN_INTERVAL_MONTHS) {
          reasons.push("INVALID_INTERVAL_BEFORE_BOOSTER_2");
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

export function countValidDtpDoses(
  records: ImmunizationRecord[],
  birthDate: string
): number {
  return evaluateDtpDoses(records, birthDate).filter(
    (result) => result.valid
  ).length;
}
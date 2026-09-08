import type { SchedulePack } from "../loader";
import type { Patient, ImmunizationRecord } from "../types";
import {
  parseDate,
  ageInMonthsAt,
  durationToMonths,
  durationToDays,
  resolveDuration
} from "./duration";

export interface ValidatedDose {
  doseNumber: number;
  productGroupId: string;
  administeredOn: string;
  valid: boolean;
  reasons: string[];
}

export interface ValidationResult {
  counterId: string;
  doses: ValidatedDose[];
  validDoseCount: number;
}

export function validateCounterDoses(
  counterId: string,
  history: ImmunizationRecord[],
  pack: SchedulePack,
  patient: Patient,
  doseValidityRules: any[]
): ValidationResult {
  const birthDate = parseDate(patient.birthDate);

  const counters: any[] = (pack.counters as any).counters ?? [];
  const counter = counters.find((c: any) => c.id === counterId);

  if (!counter) {
    return {
      counterId,
      doses: [],
      validDoseCount: 0
    };
  }

  const productGroups: string[] = Array.isArray(counter.counts_product_groups)
    ? counter.counts_product_groups
    : [];

  const relevantRecords = history
    .filter(record => productGroups.includes(record.productGroupId))
    .sort(
      (a, b) =>
        parseDate(a.administeredOn).getTime() -
        parseDate(b.administeredOn).getTime()
    );

  const doses: ValidatedDose[] = [];
  let validDoseCount = 0;
  let lastValidDoseDate: Date | null = null;
  let lastValidDoseAgeMonths: number | null = null;

  for (const record of relevantRecords) {
    const doseDate = parseDate(record.administeredOn);
    const doseAgeMonths = ageInMonthsAt(birthDate, doseDate);
    const doseNumber = validDoseCount + 1;
    const reasons: string[] = [];

    const validityRule = doseValidityRules?.find(
      (rule: any) => rule.dose === doseNumber
    );

    if (validityRule?.min_age) {
      const minAgeMonths = durationToMonths(validityRule.min_age);

      if (doseAgeMonths < minAgeMonths) {
        reasons.push(`INVALID_AGE_DOSE_${doseNumber}_TOO_EARLY`);
      }
    }

    if (validityRule?.min_interval_from_previous && lastValidDoseDate) {
      const interval = resolveDuration(
        validityRule.min_interval_from_previous,
        lastValidDoseAgeMonths ?? 0
      );

      if (interval) {
        const requiredDays = durationToDays(interval);
        const actualDays = Math.round(
          (doseDate.getTime() - lastValidDoseDate.getTime()) / 86400000
        );

        if (actualDays < requiredDays) {
          reasons.push(`INVALID_INTERVAL_BEFORE_DOSE_${doseNumber}`);
        }
      }
    }

    const isOverridden = record.overridden === true;

    if (isOverridden && reasons.length > 0) {
      reasons.push("OVERRIDDEN_BY_HEALTHCARE_PROFESSIONAL");
    }

    const valid = reasons.length === 0 || isOverridden;

    if (valid) {
      validDoseCount++;
      lastValidDoseDate = doseDate;
      lastValidDoseAgeMonths = doseAgeMonths;
    }

    doses.push({
      doseNumber,
      productGroupId: record.productGroupId,
      administeredOn: record.administeredOn,
      valid,
      reasons
    });
  }

  return {
    counterId,
    doses,
    validDoseCount
  };
}
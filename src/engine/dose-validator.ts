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
  warnings: string[];
}

export interface ValidationResult {
  counterId: string;
  doses: ValidatedDose[];
  validDoseCount: number;
}

export interface ValidityContext {
  rules: any[];
  requiredValidDoses: number;
  boosterTargets: Record<number, { minAge?: any; interval?: any }>;
}

export function validateCounterDoses(
  counterId: string,
  history: ImmunizationRecord[],
  pack: SchedulePack,
  patient: Patient,
  context: ValidityContext
): ValidationResult {
  const birthDate = parseDate(patient.birthDate);

  const counters: any[] = (pack.counters as any).counters ?? [];
  const counter = counters.find((c: any) => c.id === counterId);

  if (!counter) {
    return { counterId, doses: [], validDoseCount: 0 };
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

  // CHANGE 1: indexed loop so we can look at the previous record
  for (let i = 0; i < relevantRecords.length; i++) {
    const record = relevantRecords[i];
    const doseDate = parseDate(record.administeredOn);
    const doseAgeMonths = ageInMonthsAt(birthDate, doseDate);
    const doseNumber = validDoseCount + 1;
    const reasons: string[] = [];
    const warnings: string[] = [];

    // CHANGE 2: G8 / E2 — same product recorded twice on the same day
    const previousRecord = relevantRecords[i - 1];
    if (
      previousRecord &&
      previousRecord.productGroupId === record.productGroupId &&
      previousRecord.administeredOn === record.administeredOn
    ) {
      reasons.push("DUPLICATE_SAME_DAY");
    }

    const validityRule = context.rules?.find(
      (rule: any) => rule.dose === doseNumber
    );

    // ---------- T1: floors (invalidating) ----------
    let t1IntervalPassed = true;

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
          t1IntervalPassed = false;
        }
      }
    }

    const isOverridden = record.overridden === true;

    if (isOverridden && reasons.length > 0) {
      reasons.push("OVERRIDDEN_BY_HEALTHCARE_PROFESSIONAL");
    }

    const valid = reasons.length === 0 || isOverridden;

    // ---------- T2: policy-target deviations (counted, warned) ----------
    if (valid && doseNumber > context.requiredValidDoses) {
      const seq = doseNumber - context.requiredValidDoses;
      const target = context.boosterTargets?.[seq];

      if (target) {
        if (target.minAge) {
          const targetAgeMonths = durationToMonths(target.minAge);

          if (doseAgeMonths < targetAgeMonths) {
            warnings.push(
              `EARLY_BOOSTER_${seq}_COUNTED: administered at ${doseAgeMonths} months, policy target ${targetAgeMonths} months. Dose counted.`
            );
          }
        }

        if (target.interval && lastValidDoseDate && t1IntervalPassed) {
          const targetInterval = resolveDuration(
            target.interval,
            lastValidDoseAgeMonths ?? 0
          );

          if (targetInterval) {
            const requiredDays = durationToDays(targetInterval);
            const actualDays = Math.round(
              (doseDate.getTime() - lastValidDoseDate.getTime()) / 86400000
            );

            if (actualDays < requiredDays) {
              warnings.push(
                `SHORT_BOOSTER_${seq}_INTERVAL_COUNTED: interval shorter than policy target. Dose counted.`
              );
            }
          }
        }
      }
    }

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
      reasons,
      warnings
    });
  }

  return { counterId, doses, validDoseCount };
}
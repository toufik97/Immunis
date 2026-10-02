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
  caps: any[];
  doseZero: { productGroups: string[]; maxAgeMonths: number } | null;
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

  // ---------- dose-zero split ----------
  const zeroRecords: ImmunizationRecord[] = [];
  const countedRecords: ImmunizationRecord[] = [];

  for (const record of relevantRecords) {
    const ageAt = ageInMonthsAt(birthDate, parseDate(record.administeredOn));

    if (
      context.doseZero &&
      context.doseZero.productGroups.includes(record.productGroupId) &&
      ageAt < context.doseZero.maxAgeMonths
    ) {
      zeroRecords.push(record);
    } else {
      countedRecords.push(record);
    }
  }

  for (const record of zeroRecords) {
    doses.push({
      doseNumber: 0,
      productGroupId: record.productGroupId,
      administeredOn: record.administeredOn,
      valid: true,
      reasons: [],
      warnings: []
    });
  }

  // ---------- counted doses ----------
  let validDoseCount = 0;
  let lastValidDoseDate: Date | null = null;
  let lastValidDoseAgeMonths: number | null = null;

  for (let i = 0; i < countedRecords.length; i++) {
    const record = countedRecords[i];
    const doseDate = parseDate(record.administeredOn);
    const doseAgeMonths = ageInMonthsAt(birthDate, doseDate);
    const doseNumber = validDoseCount + 1;
    const reasons: string[] = [];
    const warnings: string[] = [];

    const previousRecord = countedRecords[i - 1];
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

    let t1IntervalPassed = true;

    if (validityRule?.min_age) {
      const minAgeMonths = durationToMonths(validityRule.min_age);
      if (doseAgeMonths < minAgeMonths) {
        reasons.push(`INVALID_AGE_DOSE_${doseNumber}_TOO_EARLY`);
      }
    }

    if (validityRule?.max_age) {
      const maxAgeMonths = durationToMonths(validityRule.max_age);
      if (doseAgeMonths >= maxAgeMonths) {
        reasons.push(`INVALID_AGE_DOSE_${doseNumber}_TOO_LATE`);
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

    if (valid && validityRule?.target_min_age) {
      const targetMonths = durationToMonths(validityRule.target_min_age);
      if (doseAgeMonths < targetMonths) {
        warnings.push(
          `EARLY_DOSE_${doseNumber}_COUNTED: administered at ${doseAgeMonths} months, recommended target ${targetMonths} months. Dose counted (no restart).`
        );
      }
    }

    if (valid) {
      for (const cap of context.caps ?? []) {
        const beforeAgeMonths = durationToMonths(cap.before_age);
        if (
          doseAgeMonths < beforeAgeMonths &&
          doseNumber > Number(cap.max_doses)
        ) {
          warnings.push(
            `DOSE_CAP_EXCEEDED_COUNTED: dose ${doseNumber} exceeds the recommended maximum of ${cap.max_doses} doses before age limit. Dose counted.`
          );
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
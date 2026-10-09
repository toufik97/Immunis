import type { SchedulePack } from "../loader";
import type { Patient, ImmunizationRecord } from "../types";
import {
  parseDate,
  ageInMonthsAt,
  durationToMonths,
  addDurationToDate,
  resolveDurationForDate,
  isAgeAtLeast,
  isAgeBefore
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
  doseZero: { productGroups: string[]; maxAge: any } | null;
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
  const zeroRecords: ImmunizationRecord[] = [];
  const countedRecords: ImmunizationRecord[] = [];

  for (const record of relevantRecords) {
    if (
      context.doseZero &&
      context.doseZero.productGroups.includes(record.productGroupId) &&
      isAgeBefore(
        birthDate,
        parseDate(record.administeredOn),
        context.doseZero.maxAge
      )
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
    // A same-day duplicate of the same product is a data error, not a dose.
    const isDuplicateSameDay = Boolean(
      previousRecord &&
      previousRecord.productGroupId === record.productGroupId &&
      previousRecord.administeredOn === record.administeredOn
    );
    if (isDuplicateSameDay) {
      reasons.push("DUPLICATE_SAME_DAY");
    }

    const validityRule = (() => {
      const base = context.rules?.find(
        (rule: any) => rule.dose === doseNumber && !rule.product_group
      );
      const overlay = context.rules?.find(
        (rule: any) =>
          rule.dose === doseNumber &&
          rule.product_group === record.productGroupId
      );
      if (!base) return overlay;
      if (!overlay) return base;
      // Overlay ADDS product-specific targets (target_min_age, dose_amount),
      // never SHADOWS base timing. Base min/max age and intervals always win.
      const merged: any = { ...base };
      for (const [k, v] of Object.entries(overlay)) {
        if (k === "dose" || k === "product_group") continue;
        if (k === "min_age" || k === "max_age" || k === "min_interval_from_previous") continue;
        merged[k] = v;
      }
      return merged;
    })();

    let t1IntervalPassed = true;

    if (validityRule?.min_age) {
      if (!isAgeAtLeast(birthDate, doseDate, validityRule.min_age)) {
        reasons.push(`INVALID_AGE_DOSE_${doseNumber}_TOO_EARLY`);
      }
    }

    if (validityRule?.max_age) {
      if (!isAgeBefore(birthDate, doseDate, validityRule.max_age)) {
        reasons.push(`INVALID_AGE_DOSE_${doseNumber}_TOO_LATE`);
      }
    }

    if (validityRule?.min_interval_from_previous && lastValidDoseDate) {
      const interval = resolveDurationForDate(
        validityRule.min_interval_from_previous,
        birthDate,
        lastValidDoseDate
      );
      if (interval) {
        // Calendar math, like the planner: 6 months after Jan 15 is Jul 15,
        // not "183 days" (which can be a day too many or too few).
        if (doseDate.getTime() < addDurationToDate(lastValidDoseDate, interval).getTime()) {
          reasons.push(`INVALID_INTERVAL_BEFORE_DOSE_${doseNumber}`);
          t1IntervalPassed = false;
        }
      }
      // Conditional gap (e.g. G14: booster before 24m has no branch) means
      // "no constraint" by pack design — stays silent to preserve routine
      // zero-warning behavior. Pack review flags document the intent.
    }

    const isOverridden = record.overridden === true;
    if (isOverridden && reasons.length > 0 && !isDuplicateSameDay) {
      reasons.push("OVERRIDDEN_BY_HEALTHCARE_PROFESSIONAL");
    }
    // An override can waive clinical timing rules, but never a same-day
    // duplicate: two identical records on one day is a data error, not a dose.
    const valid = !isDuplicateSameDay && (reasons.length === 0 || isOverridden);

    if (valid && doseNumber > context.requiredValidDoses) {
      const seq = doseNumber - context.requiredValidDoses;
      const target = context.boosterTargets?.[seq];
      if (target) {
        if (target.minAge) {
          const targetAgeMonths = durationToMonths(target.minAge);
          if (!isAgeAtLeast(birthDate, doseDate, target.minAge)) {
            warnings.push(
              `EARLY_BOOSTER_${seq}_COUNTED: administered at ${doseAgeMonths} months, policy target ${targetAgeMonths} months. Dose counted.`
            );
          }
        }
        if (target.interval && lastValidDoseDate && t1IntervalPassed) {
          const targetInterval = resolveDurationForDate(
            target.interval,
            birthDate,
            lastValidDoseDate
          );
          if (targetInterval) {
            if (doseDate.getTime() < addDurationToDate(lastValidDoseDate, targetInterval).getTime()) {
              warnings.push(
                `SHORT_BOOSTER_${seq}_INTERVAL_COUNTED: interval shorter than policy target. Dose counted.`
              );
            }
          }
          // Gap = no constraint by design (G14); silent.
        }
      }
    }

    if (valid && validityRule?.target_min_age) {
      const targetMonths = durationToMonths(validityRule.target_min_age);
      if (!isAgeAtLeast(birthDate, doseDate, validityRule.target_min_age)) {
        warnings.push(
          `EARLY_DOSE_${doseNumber}_COUNTED: administered at ${doseAgeMonths} months, recommended target ${targetMonths} months. Dose counted (no restart).`
        );
      }
    }

    if (valid) {
      for (const cap of context.caps ?? []) {
        if (
          isAgeBefore(birthDate, doseDate, cap.before_age) &&
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

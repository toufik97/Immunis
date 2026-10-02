import type { SchedulePack } from "../loader";
import type { Patient, ImmunizationRecord, DoseCounts } from "../types";
import {
  validateCounterDoses,
  type ValidationResult,
  type ValidityContext
} from "./dose-validator";
import { durationToMonths } from "./duration";

export interface DoseValidationMap {
  [counterId: string]: ValidationResult;
}

export function countDoses(
  history: ImmunizationRecord[],
  pack: SchedulePack,
  patient: Patient
): { counts: DoseCounts; validations: DoseValidationMap } {
  const counts: DoseCounts = {};
  const validations: DoseValidationMap = {};

  const counters: any[] = (pack.counters as any).counters ?? [];
  const allPrograms: any[] = Object.values(pack.programs) as any[];

  for (const counter of counters) {
    const owner = allPrograms.find(
      (p: any) => p.program?.counter === counter.id
    );

    const context: ValidityContext = owner
      ? buildValidityContext(owner, allPrograms, counter.id)
      : {
          rules: [],
          requiredValidDoses: 0,
          boosterTargets: {},
          caps: [],
          doseZero: null
        };

    const result = validateCounterDoses(
      counter.id,
      history,
      pack,
      patient,
      context
    );

    counts[counter.id] = result.validDoseCount;
    validations[counter.id] = result;
  }

  return { counts, validations };
}

function collectCaps(allPrograms: any[], counterId: string): any[] {
  const seen = new Set<string>();

  return allPrograms
    .flatMap((p: any) => p?.dose_caps ?? [])
    .filter((c: any) => c.counter === counterId)
    .filter((c: any) => {
      const key = JSON.stringify(c);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildValidityContext(
  program: any,
  allPrograms: any[],
  counterId: string
): ValidityContext {
  const primary = program?.primary_series ?? {};
  const rules: any[] = primary.dose_validity ?? [];
  const requiredValidDoses: number = primary.required_valid_doses ?? 0;

  const policies: any[] = program?.booster_policies ?? [];
  const policy =
    policies.find((p: any) => p.id === primary.booster_policy) ?? policies[0];

  const boosterTargets: Record<number, { minAge?: any; interval?: any }> = {};

  if (policy) {
    for (let seq = 1; ; seq++) {
      const config = policy[`booster_${seq}`];
      if (!config) break;

      boosterTargets[seq] = {
        minAge: config.min_age,
        interval:
          seq === 1
            ? config.min_interval_after_primary_completion
            : config.min_interval_after_booster_1
      };
    }
  }

  const doseZero = primary.dose_zero
    ? {
        productGroups: (primary.dose_zero.product_groups ?? []) as string[],
        maxAgeMonths: durationToMonths(primary.dose_zero.max_age)
      }
    : null;

  return {
    rules,
    requiredValidDoses,
    boosterTargets,
    caps: collectCaps(allPrograms, counterId),
    doseZero
  };
}
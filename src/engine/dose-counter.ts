import type { SchedulePack } from "../loader";
import type { Patient, ImmunizationRecord, DoseCounts } from "../types";
import {
  validateCounterDoses,
  type ValidationResult,
  type ValidityContext
} from "./dose-validator";

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

  for (const counter of counters) {
    let context: ValidityContext = {
      rules: [],
      requiredValidDoses: 0,
      boosterTargets: {}
    };

    for (const program of Object.values(pack.programs) as any[]) {
      if (program.program?.counter === counter.id) {
        context = buildValidityContext(program);
        break;
      }
    }

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

function buildValidityContext(program: any): ValidityContext {
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

  return { rules, requiredValidDoses, boosterTargets };
}
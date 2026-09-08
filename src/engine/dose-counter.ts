import type { SchedulePack } from "../loader";
import type { Patient, ImmunizationRecord, DoseCounts } from "../types";
import {
  validateCounterDoses,
  type ValidationResult
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
    let doseValidityRules: any[] = [];

    for (const program of Object.values(pack.programs) as any[]) {
      if (program.program?.counter === counter.id) {
        doseValidityRules = program.primary_series?.dose_validity ?? [];
        break;
      }
    }

    const result = validateCounterDoses(
      counter.id,
      history,
      pack,
      patient,
      doseValidityRules
    );

    counts[counter.id] = result.validDoseCount;
    validations[counter.id] = result;
  }

  return { counts, validations };
}
import type { SchedulePack } from "../infra/packs/loader";
import type { Patient, ImmunizationRecord, DoseCounts } from "../types";
import type { BoosterConfig, DoseCap, DoseValidityRule, Interval, PackDuration, Program } from "../infra/packs/schema";
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

  const counters = pack.counters.counters ?? [];
  const allPrograms: Program[] = Object.values(pack.programs);

  for (const counter of counters) {
    const owner = allPrograms.find(
      (p) => p.program?.counter === counter.id
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

function collectCaps(allPrograms: Program[], counterId: string): DoseCap[] {
  const seen = new Set<string>();

  return allPrograms
    .flatMap((p) => p?.dose_caps ?? [])
    .filter((c) => c.counter === counterId)
    .filter((c) => {
      const key = JSON.stringify(c);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildValidityContext(
  program: Program,
  allPrograms: Program[],
  counterId: string
): ValidityContext {
  const primary = program?.primary_series ?? {};
  const rules: DoseValidityRule[] = primary.dose_validity ?? [];
  const requiredValidDoses: number = primary.required_valid_doses ?? 0;

  const policies = program?.booster_policies ?? [];
  const policy: Record<string, unknown> | undefined =
    (policies.find((p) => (p as { id?: string }).id === primary.booster_policy) ?? policies[0]) as
      | Record<string, unknown>
      | undefined;

  const boosterTargets: Record<number, { minAge?: PackDuration; interval?: Interval }> = {};

  if (policy) {
    for (let seq = 1; ; seq++) {
      const config = (policy as Record<string, BoosterConfig | undefined>)[`booster_${seq}`];
      if (!config) break;

      // Support booster_N specific intervals; fall back to booster_1 pattern.
      const cfg = config as BoosterConfig & Record<string, Interval | undefined>;
      const interval: Interval | undefined =
        seq === 1
          ? cfg.min_interval_after_primary_completion
          : (cfg[`min_interval_after_booster_${seq - 1}`] ??
            cfg.min_interval_after_booster_1);
      boosterTargets[seq] = {
        minAge: config.min_age,
        interval
      };
    }
  }

  const doseZero = primary.dose_zero
    ? {
        productGroups: (primary.dose_zero.product_groups ?? []) as string[],
        maxAge: primary.dose_zero.max_age
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
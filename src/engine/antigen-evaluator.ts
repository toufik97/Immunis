import type { SchedulePack } from "../loader";
import type { Patient, DoseCounts, AntigenNeed, AvailabilityInput } from "../types";
import type { DoseValidationMap } from "./dose-counter";
import { parseDate, ageInMonthsAt, isAgeAtLeast, isAgeBefore } from "./duration";

export interface EvaluationContext {
  validations?: DoseValidationMap;
  availability?: AvailabilityInput;
}

interface MatchEnv {
  birthDate: Date;
  evaluationDate: Date;
  ageMonths: number;
  validDoses: number;
  programCounterId: string;
  perProduct: Record<string, number>;
  total: number;
  isAvailable: (pid: string) => boolean;
}

export function evaluateAllPrograms(
  pack: SchedulePack,
  patient: Patient,
  doseCounts: DoseCounts,
  evaluationDate: Date,
  context?: EvaluationContext
): AntigenNeed[] {
  const needs: AntigenNeed[] = [];
  for (const program of Object.values(pack.programs) as any[]) {
    needs.push(
      evaluateProgram(pack, program, patient, doseCounts, evaluationDate, context)
    );
  }
  return needs;
}

export function evaluateProgram(
  pack: SchedulePack,
  program: any,
  patient: Patient,
  doseCounts: DoseCounts,
  evaluationDate: Date,
  context?: EvaluationContext
): AntigenNeed {
  const programId = program.program?.id;
  const counterId = program.program?.counter;
  const antigenTargets: string[] = program.program?.antigen_targets ?? [];
  const validDosesReceived = doseCounts[counterId] ?? 0;

  const need: AntigenNeed = {
    programId,
    antigenTargets,
    counterId,
    validDosesReceived,
    dosesNeeded: 0,
    status: "NOT_NEEDED",
    matchedRuleId: null,
    action: null,
    boosterSequence: null,
    boosterPolicyId: null,
    warnings: []
  };

  if (!programId || !counterId) {
    need.warnings.push("Program is missing id or counter");
    return need;
  }

  if (antigenTargets.length === 0) {
    need.warnings.push("Program is missing antigen_targets");
  }

  const birthDate = parseDate(patient.birthDate);
  const ageMonths = ageInMonthsAt(birthDate, evaluationDate);

  // Per-product dose counts from validations (drives `product_history` conditions)
  const perProduct: Record<string, number> = {};
  if (context?.validations) {
    const doseList = (context.validations[counterId]?.doses ?? []).filter(
      (d: any) => d.valid && d.doseNumber > 0
    );
    for (const d of doseList) {
      perProduct[d.productGroupId] = (perProduct[d.productGroupId] ?? 0) + 1;
    }
  }

  // Availability resolver (drives `availability` conditions)
  const availability = context?.availability;
  const policy = availability?.policy ?? "TRANSITION";
  const stockList = availability?.products;
  const policiesCfg: any[] =
    pack.productSelection?.product_selection?.availability_policies ?? [];
  const policyCfg = policiesCfg.find((p: any) => p.id === policy) ?? policiesCfg[0];
  const reserved: any[] = policyCfg?.reserved ?? [];
  const isAvailable = (pid: string): boolean => {
    if (stockList) return stockList.includes(pid);
    const res = reserved.find((r: any) => r.product_group === pid);
    if (!res) return true;
    if (res.reserve_for === "history_starters") return (perProduct[pid] ?? 0) > 0;
    return true;
  };

  const env: MatchEnv = {
    birthDate,
    evaluationDate,
    ageMonths,
    validDoses: validDosesReceived,
    programCounterId: counterId,
    perProduct,
    total: validDosesReceived,
    isAvailable
  };

  const rules: any[] = program.catchup_rules ?? [];
  let matchedRule: any = null;
  for (const rule of rules) {
    if (matchesRule(rule, env)) {
      matchedRule = rule;
      break;
    }
  }

  if (!matchedRule) {
    // Fail closed: "no rule matched" must never look like "nothing needed".
    need.status = "UNDETERMINED";
    need.warnings.push(
      `NO_MATCHING_RULE: No matching catch-up rule for age ${ageMonths} months and ${validDosesReceived} valid doses`
    );
    return need;
  }

  need.matchedRuleId = matchedRule.id ?? null;
  const then = matchedRule.then ?? {};
  need.action = then.action ?? null;

  // NEW: variant-based dosing. The rule declares how many primaries and
  // boosters this product-track requires; the evaluator derives the state.
  if (then.required_primaries !== undefined || then.booster_count !== undefined) {
    const RP = Number(then.required_primaries ?? 0);
    const BC = Number(then.booster_count ?? 0);
    need.requiredPrimaries = RP;
    need.boosterCount = BC;
    need.boosterPolicyId =
      then.booster_policy ?? program.primary_series?.booster_policy ?? null;
    if (then.target_product !== undefined) {
      need.targetProduct = then.target_product ?? null;
    }
    if (RP === 0 && BC === 0) {
      need.status = "NOT_NEEDED";
      need.dosesNeeded = 0;
      need.action = "none";
    } else {
      const givenPrimaries = Math.min(validDosesReceived, RP);
      const remainingPrimaries = Math.max(0, RP - givenPrimaries);
      if (remainingPrimaries > 0) {
        need.status = "NEEDS_PRIMARY";
        need.dosesNeeded = remainingPrimaries;
        need.action = "complete_primary";
      } else if (BC > 0) {
        const boostersGiven = Math.max(0, validDosesReceived - RP);
        if (boostersGiven < BC) {
          need.status = "NEEDS_BOOSTER";
          need.dosesNeeded = 0;
          need.boosterSequence = boostersGiven + 1;
          need.action = "give_booster_if_due";
        } else {
          need.status = "COMPLETE";
          need.dosesNeeded = 0;
          need.action = "complete";
        }
      } else {
        need.status = "COMPLETE";
        need.dosesNeeded = 0;
        need.action = "complete";
      }
    }
    return need;
  }

  // Existing action handling (unchanged)
  switch (then.action) {
    case "complete_primary": {
      const fallbackRequired = program.primary_series?.required_valid_doses ?? 0;
      const dosesNeeded =
        then.doses_needed ?? Math.max(0, fallbackRequired - validDosesReceived);
      need.dosesNeeded = dosesNeeded;
      need.status = dosesNeeded > 0 ? "NEEDS_PRIMARY" : "COMPLETE";
      need.boosterPolicyId =
        then.booster_policy ?? program.primary_series?.booster_policy ?? null;
      break;
    }
    case "complete_remaining": {
      const requiredDoses = program.primary_series?.required_valid_doses ?? 0;
      const remaining = Math.max(0, requiredDoses - validDosesReceived);
      need.dosesNeeded = remaining;
      need.status = remaining > 0 ? "NEEDS_PRIMARY" : "COMPLETE";
      need.boosterPolicyId =
        then.booster_policy ?? program.primary_series?.booster_policy ?? null;
        break;
    }
    case "schedule_booster":
    case "give_booster_if_due": {
      need.status = "NEEDS_BOOSTER";
      need.dosesNeeded = 0;
      need.boosterSequence = then.booster_sequence ?? 1;
      need.boosterPolicyId =
        then.booster_policy ?? program.primary_series?.booster_policy ?? null;
      break;
    }
    case "complete": {
      need.status = "COMPLETE";
      need.dosesNeeded = 0;
      break;
    }
    case "none": {
      need.status = "NOT_NEEDED";
      need.dosesNeeded = 0;
      break;
    }
    default: {
      need.status = "UNDETERMINED";
      need.warnings.push(`UNKNOWN_ACTION: Unknown action: ${then.action}`);
    }
  }

  return need;
}

function matchesRule(rule: any, env: MatchEnv): boolean {
  const when = rule.when;
  if (!when) {
    return false;
  }

  if (when.age) {
    if (
      when.age.from &&
      !isAgeAtLeast(env.birthDate, env.evaluationDate, when.age.from)
    ) {
      return false;
    }
    if (
      when.age.to_before &&
      !isAgeBefore(env.birthDate, env.evaluationDate, when.age.to_before)
    ) {
      return false;
    }
  }

  if (when.counter) {
    if (when.counter.id && when.counter.id !== env.programCounterId) return false;
    if (when.counter.equals !== undefined && env.validDoses !== when.counter.equals) return false;
    if (when.counter.gte !== undefined && env.validDoses < when.counter.gte) return false;
  }

  // NEW: per-product history counts
  if (when.product_history) {
    for (const [pid, cond] of Object.entries(when.product_history as Record<string, any>)) {
      const n = pid === "_TOTAL" ? env.total : (env.perProduct[pid] ?? 0);
      const c = cond as any;
      if (c.equals !== undefined && n !== Number(c.equals)) return false;
      if (c.gte !== undefined && n < Number(c.gte)) return false;
      if (c.lte !== undefined && n > Number(c.lte)) return false;
    }
  }

  // NEW: stock availability
  if (when.availability) {
    if (when.availability.includes && !env.isAvailable(when.availability.includes)) return false;
    if (when.availability.excludes && env.isAvailable(when.availability.excludes)) return false;
  }

  return true;
}

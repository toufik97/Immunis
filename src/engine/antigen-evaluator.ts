import type { SchedulePack } from "../loader";
import type { Patient, DoseCounts, AntigenNeed } from "../types";
import { parseDate, ageInMonthsAt, durationToMonths } from "./duration";

export function evaluateAllPrograms(
  pack: SchedulePack,
  patient: Patient,
  doseCounts: DoseCounts,
  evaluationDate: Date
): AntigenNeed[] {
  const needs: AntigenNeed[] = [];

  for (const program of Object.values(pack.programs) as any[]) {
    needs.push(
      evaluateProgram(program, patient, doseCounts, evaluationDate)
    );
  }

  return needs;
}

export function evaluateProgram(
  program: any,
  patient: Patient,
  doseCounts: DoseCounts,
  evaluationDate: Date
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

  const rules: any[] = program.catchup_rules ?? [];
  let matchedRule: any = null;

  for (const rule of rules) {
    if (matchesRule(rule, ageMonths, validDosesReceived, counterId)) {
      matchedRule = rule;
      break;
    }
  }

  if (!matchedRule) {
    need.warnings.push(
      `No matching catch-up rule for age ${ageMonths} months and ${validDosesReceived} valid doses`
    );
    return need;
  }

  need.matchedRuleId = matchedRule.id ?? null;

  const then = matchedRule.then ?? {};
  need.action = then.action ?? null;

  switch (then.action) {
    case "complete_primary": {
      const fallbackRequired =
        program.primary_series?.required_valid_doses ?? 0;

      const dosesNeeded =
        then.doses_needed ??
        Math.max(0, fallbackRequired - validDosesReceived);

      need.dosesNeeded = dosesNeeded;
      need.status = dosesNeeded > 0 ? "NEEDS_PRIMARY" : "COMPLETE";
      need.boosterPolicyId =
        then.booster_policy ??
        program.primary_series?.booster_policy ??
        null;
      break;
    }

    case "complete_remaining": {
      const requiredDoses =
        program.primary_series?.required_valid_doses ?? 0;

      const remaining = Math.max(0, requiredDoses - validDosesReceived);

      need.dosesNeeded = remaining;
      need.status = remaining > 0 ? "NEEDS_PRIMARY" : "COMPLETE";
      need.boosterPolicyId =
        then.booster_policy ??
        program.primary_series?.booster_policy ??
        null;
      break;
    }

    case "schedule_booster":
    case "give_booster_if_due": {
      need.status = "NEEDS_BOOSTER";
      need.dosesNeeded = 0;
      need.boosterSequence = then.booster_sequence ?? 1;
      need.boosterPolicyId =
        then.booster_policy ??
        program.primary_series?.booster_policy ??
        null;
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
      need.warnings.push(`Unknown action: ${then.action}`);
    }
  }

  return need;
}

function matchesRule(
  rule: any,
  ageMonths: number,
  validDoses: number,
  programCounterId: string
): boolean {
  const when = rule.when;

  if (!when) {
    return false;
  }

  if (when.age) {
    if (when.age.from) {
      const fromMonths = durationToMonths(when.age.from);

      if (ageMonths < fromMonths) {
        return false;
      }
    }

    if (when.age.to_before) {
      const toMonths = durationToMonths(when.age.to_before);

      if (ageMonths >= toMonths) {
        return false;
      }
    }
  }

  if (when.counter) {
    if (when.counter.id && when.counter.id !== programCounterId) {
      return false;
    }

    if (when.counter.equals !== undefined) {
      if (validDoses !== when.counter.equals) {
        return false;
      }
    }

    if (when.counter.gte !== undefined) {
      if (validDoses < when.counter.gte) {
        return false;
      }
    }
  }

  return true;
}
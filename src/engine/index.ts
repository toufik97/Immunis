import type { SchedulePack } from "../loader";
import type {
  Patient,
  ImmunizationRecord,
  DoseCounts,
  AntigenNeed,
  ProductSelectionResult,
  VisitPlan,
  EvaluateOptions
} from "../types";
import { countDoses, type DoseValidationMap } from "./dose-counter";
import { evaluateAllPrograms } from "./antigen-evaluator";
import { selectProducts } from "./product-selector";
import { planVisits } from "./visit-planner";
import { parseDate, isAgeBefore, describeDuration } from "./duration";

export interface EngineResult {
  patient: Patient;
  evaluationDate: Date;
  doseCounts: DoseCounts;
  doseValidations: DoseValidationMap;
  antigenNeeds: AntigenNeed[];
  productSelection: ProductSelectionResult;
  visitPlan: VisitPlan;
  assumptions: string[];
}

export function evaluatePatient(
  patient: Patient,
  history: ImmunizationRecord[],
  pack: SchedulePack,
  evaluationDate: Date,
  options: EvaluateOptions = {}
): EngineResult {
  // 1. Count and validate recorded doses
  const { counts, validations } = countDoses(history, pack, patient);

  // 2. What does each program still need?
  const antigenNeeds = evaluateAllPrograms(
    pack,
    patient,
    counts,
    evaluationDate,
    { validations, availability: options.availability }
  );

  // 3. Stop planning when the dose cap is reached (SOMIPEV guard)
  applyDoseCaps(antigenNeeds, pack, validations, patient, evaluationDate);

  // 4. Choose products
  const productSelection = selectProducts(
    antigenNeeds,
    pack,
    patient,
    evaluationDate,
    validations
  );

  // 5. Build dated visits
  const programLastDates = buildProgramLastDates(pack, validations);
  const visitPlan = planVisits(
    productSelection,
    antigenNeeds,
    pack,
    patient,
    history,
    evaluationDate,
    programLastDates,
    options.projection ?? "next"
  );

  // 6. Availability assumption (was emitted by the resolver; now generated here)
  const assumptions: string[] = [];
  if (!options.availability?.products) {
    const policy = options.availability?.policy ?? "TRANSITION";
    assumptions.push(
      `PCV availability assumed by policy ${policy} (stock not connected).`
    );
  }

  return {
    patient,
    evaluationDate,
    doseCounts: counts,
    doseValidations: validations,
    antigenNeeds,
    productSelection,
    visitPlan,
    assumptions
  };
}

function applyDoseCaps(
  needs: AntigenNeed[],
  pack: SchedulePack,
  validations: DoseValidationMap,
  patient: Patient,
  evaluationDate: Date
): void {
  const birthDate = parseDate(patient.birthDate);
  for (const need of needs) {
    const program: any = (pack.programs as any)[need.programId];
    const caps: any[] = program?.dose_caps ?? [];
    for (const cap of caps) {
      if (!isAgeBefore(birthDate, evaluationDate, cap.before_age)) continue;
      const validation = validations[cap.counter];
      const dosesBeforeCapAge = (validation?.doses ?? []).filter((d: any) => {
        if (!d.valid) return false;
        return isAgeBefore(
          birthDate,
          parseDate(d.administeredOn),
          cap.before_age
        );
      }).length;
      if (dosesBeforeCapAge >= Number(cap.max_doses)) {
        need.dosesNeeded = 0;
        need.boosterSequence = null;
        need.status = "COMPLETE";
        need.action = "complete";
        need.warnings.push(
          `DOSE_CAP_REACHED_PLANNING_STOPPED: ${cap.max_doses} doses already given before ${describeDuration(cap.before_age)}; no further dose planned (hyperimmunization guard).`
        );
      }
    }
  }
}

function buildProgramLastDates(
  pack: SchedulePack,
  validations: DoseValidationMap
): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const program of Object.values(pack.programs) as any[]) {
    const programId = program.program?.id;
    const counterId = program.program?.counter;
    if (!programId || !counterId) continue;
    const validation = validations[counterId];
    if (!validation) {
      result[programId] = null;
      continue;
    }
    const validDoses = validation.doses.filter(dose => dose.valid);
    result[programId] = validDoses.length
      ? validDoses[validDoses.length - 1].administeredOn
      : null;
  }
  return result;
}

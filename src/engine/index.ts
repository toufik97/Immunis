import type { SchedulePack } from "../loader";
import type {
  Patient,
  ImmunizationRecord,
  DoseCounts,
  AntigenNeed,
  ProductSelectionResult,
  VisitPlan
} from "../types";

import { countDoses, type DoseValidationMap } from "./dose-counter";
import { evaluateAllPrograms } from "./antigen-evaluator";
import { selectProducts } from "./product-selector";
import { planVisits } from "./visit-planner";

export interface EngineResult {
  patient: Patient;
  evaluationDate: Date;
  doseCounts: DoseCounts;
  doseValidations: DoseValidationMap;
  antigenNeeds: AntigenNeed[];
  productSelection: ProductSelectionResult;
  visitPlan: VisitPlan;
}

export function evaluatePatient(
  patient: Patient,
  history: ImmunizationRecord[],
  pack: SchedulePack,
  evaluationDate: Date
): EngineResult {
  const { counts, validations } = countDoses(history, pack, patient);

  const antigenNeeds = evaluateAllPrograms(
    pack,
    patient,
    counts,
    evaluationDate
  );

  const programLastDates = buildProgramLastDates(pack, validations);

  const productSelection = selectProducts(
    antigenNeeds,
    pack,
    patient,
    evaluationDate
  );

  const visitPlan = planVisits(
    productSelection,
    antigenNeeds,
    pack,
    patient,
    evaluationDate,
    programLastDates
  );

  return {
    patient,
    evaluationDate,
    doseCounts: counts,
    doseValidations: validations,
    antigenNeeds,
    productSelection,
    visitPlan
  };
}

function buildProgramLastDates(
  pack: SchedulePack,
  validations: DoseValidationMap
): Record<string, string | null> {
  const result: Record<string, string | null> = {};

  for (const program of Object.values(pack.programs) as any[]) {
    const programId = program.program?.id;
    const counterId = program.program?.counter;

    if (!programId || !counterId) {
      continue;
    }

    const validation = validations[counterId];

    if (!validation) {
      result[programId] = null;
      continue;
    }

    const validDoses = validation.doses.filter(dose => dose.valid);

    if (validDoses.length === 0) {
      result[programId] = null;
      continue;
    }

    result[programId] = validDoses[validDoses.length - 1].administeredOn;
  }

  return result;
}
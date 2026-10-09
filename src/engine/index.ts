import type { SchedulePack } from "../infra/packs/loader";
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
import { normalizeHistory } from "./history";
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
  /** problems with the input itself, e.g. a product id the catalog does not know */
  inputWarnings: string[];
}

export function evaluatePatient(
  patient: Patient,
  rawHistory: ImmunizationRecord[],
  pack: SchedulePack,
  evaluationDate: Date,
  options: EvaluateOptions = {}
): EngineResult {
  // 0. Accept retired product ids (aliases) and flag unknown ones
  const { history, warnings: inputWarnings } = normalizeHistory(rawHistory, pack);

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

  // 3. Stop planning when the dose cap is reached (SOMIPEV guard).
  // Pure: returns a new array, never mutates evaluator output.
  const cappedNeeds = applyDoseCaps(antigenNeeds, pack, validations, patient, evaluationDate);

  // 4. Choose products
  const productSelection = selectProducts(
    cappedNeeds,
    pack,
    patient,
    evaluationDate,
    validations
  );

  // 5. Build dated visits
  const programLastDates = buildProgramLastDates(pack, validations);
  const visitPlan = planVisits(
    productSelection,
    cappedNeeds,
    pack,
    patient,
    history,
    evaluationDate,
    programLastDates,
    options.projection ?? "next"
  );

  assertPlanInvariants(cappedNeeds, productSelection, visitPlan);

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
    antigenNeeds: cappedNeeds,
    productSelection,
    visitPlan,
    assumptions,
    inputWarnings
  };
}

/** Return invariants the future system can rely on. Throws on hard violations. */
function assertPlanInvariants(
  needs: AntigenNeed[],
  selection: ProductSelectionResult,
  plan: VisitPlan
): void {
  for (const b of selection.boosterPlans) {
    if (!b.productGroupId) {
      throw new Error(`INVARIANT: booster plan for ${b.programId} has empty productGroupId`);
    }
  }
  for (const s of selection.primarySlots) {
    for (const p of s.products) {
      if (!p.productGroupId) {
        throw new Error(`INVARIANT: primary slot ${s.slot} has empty productGroupId`);
      }
      if (p.coveredProgramIds.length === 0) {
        throw new Error(`INVARIANT: primary slot ${s.slot} covers no programs`);
      }
    }
  }
  for (const v of plan.visits) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) {
      throw new Error(`INVARIANT: visit ${v.visitNumber} has bad date "${v.date}"`);
    }
    if (v.products.some(p => !p)) {
      throw new Error(`INVARIANT: visit ${v.visitNumber} has empty product`);
    }
  }
  void needs;
}

function applyDoseCaps(
  needs: AntigenNeed[],
  pack: SchedulePack,
  validations: DoseValidationMap,
  patient: Patient,
  evaluationDate: Date
): AntigenNeed[] {
  void evaluationDate;
  const birthDate = parseDate(patient.birthDate);
  return needs.map((need) => {
    const program = pack.programs[need.programId];
    const caps = program?.dose_caps ?? [];
    let out: AntigenNeed = need;
    for (const cap of caps) {
      const validation = validations[cap.counter];
      const dosesBeforeCapAge = (validation?.doses ?? []).filter((d) => {
        if (!d.valid) return false;
        return isAgeBefore(birthDate, parseDate(d.administeredOn), cap.before_age);
      }).length;
      if (dosesBeforeCapAge >= Number(cap.max_doses)) {
        const base: AntigenNeed =
          out === need ? { ...need, warnings: [...need.warnings] } : out;
        if (base.status !== "UNDETERMINED") {
          base.dosesNeeded = 0;
          base.boosterSequence = null;
          base.status = "COMPLETE";
          base.action = "complete";
        }
        base.warnings.push(
          `DOSE_CAP_REACHED_PLANNING_STOPPED: ${cap.max_doses} doses already given before ${describeDuration(cap.before_age)}; no further dose planned (hyperimmunization guard).`
        );
        out = base;
      }
    }
    return out;
  });
}

function buildProgramLastDates(
  pack: SchedulePack,
  validations: DoseValidationMap
): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const program of Object.values(pack.programs)) {
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

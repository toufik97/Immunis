import type { SchedulePack } from "../infra/packs/loader";
import { evaluatePatient } from "../engine";
import { parseDate } from "../engine/duration";
import type { Patient, ImmunizationRecord } from "../types";
import { isClinicallyCredited } from "../domain/dose-origin";
import type { DoseRecord } from "../domain/encounter";

/**
 * North-star use case: evaluate + record in minimal clicks.
 * Maps stored DoseRecords (with origin) to engine history:
 * engine sees CENTRE + EXTERNAL, never CAMPAIGN.
 */
export function toEngineHistory(doses: DoseRecord[]): ImmunizationRecord[] {
  return doses
    .filter((d) => isClinicallyCredited(d.origin))
    .map((d) => ({
      administeredOn: d.administeredOn,
      productGroupId: d.productGroupId,
      overridden: d.overridden,
    }));
}

export function evaluateChild(
  birthDate: string,
  doses: DoseRecord[],
  pack: SchedulePack,
  evaluationDate: string,
  availability?: { policy?: "TRANSITION" | "CONTINUITY_FIRST" | "STOCK_DRIVEN"; products?: string[] }
) {
  const history = toEngineHistory(doses);
  return evaluatePatient(
    { birthDate } as Patient,
    history,
    pack,
    parseDate(evaluationDate),
    { availability }
  );
}

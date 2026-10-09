import type { SchedulePack } from "../infra/packs/loader";
import { evaluatePatient } from "../engine";
import { parseDate } from "../engine/duration";
import type { Patient, ImmunizationRecord } from "../types";
import { isClinicallyCredited } from "../domain/dose-origin";
import type { DoseRecord } from "../domain/encounter";

/**
 * North-star use case: evaluate + record in minimal clicks.
 * Single seam for stored DoseRecord → engine history mapping:
 * the engine sees CENTRE + EXTERNAL (never CAMPAIGN), with pack
 * aliases canonicalized so history rows using old ids count correctly.
 */
/** Canonical product-group id (alias → canonical); unknown ids pass through. */
export function canonicalProductId(pack: SchedulePack, id: string): string {
  for (const g of pack.catalog.product_groups ?? []) {
    if (g.id === id) return id;
    if ((g.aliases ?? []).includes(id)) return g.id;
  }
  return id;
}

export function toEngineHistory(doses: DoseRecord[], pack?: SchedulePack): ImmunizationRecord[] {
  const canon = pack ? (id: string) => canonicalProductId(pack, id) : (id: string) => id;
  return doses
    .filter((d) => isClinicallyCredited(d.origin))
    .map((d) => ({
      administeredOn: d.administeredOn,
      productGroupId: canon(d.productGroupId),
      overridden: d.overridden,
    }));
}

/**
 * Engine history for the record gate: prior stored doses (CENTRE + EXTERNAL,
 * canonicalized, override flags kept) plus incoming gated doses
 * (CENTRE + EXTERNAL, canonicalized, overrides stripped so issues surface).
 */
export function toGatedEngineHistory(
  prior: DoseRecord[],
  incoming: DoseRecord[],
  pack: SchedulePack
): ImmunizationRecord[] {
  const canon = (id: string) => canonicalProductId(pack, id);
  return [
    ...toEngineHistory(prior, pack),
    ...incoming
      .filter((d) => isClinicallyCredited(d.origin))
      .map((d) => ({
        administeredOn: d.administeredOn,
        productGroupId: canon(d.productGroupId),
        overridden: false,
      })),
  ];
}

/** Products of the first planned visit after the recording date (session prep). */
export function nextExpectedProducts(
  result: Pick<ReturnType<typeof evaluatePatient>, "visitPlan">,
  afterDate: string
): string[] {
  const visits = result.visitPlan.visits;
  const upcoming = visits.find((v) => v.date > afterDate) ?? visits[0];
  return upcoming?.products ?? [];
}

export function evaluateChild(
  birthDate: string,
  doses: DoseRecord[],
  pack: SchedulePack,
  evaluationDate: string,
  availability?: { policy?: "TRANSITION" | "CONTINUITY_FIRST" | "STOCK_DRIVEN"; products?: string[] }
) {
  const history = toEngineHistory(doses, pack);
  return evaluatePatient(
    { birthDate } as Patient,
    history,
    pack,
    parseDate(evaluationDate),
    { availability }
  );
}

import type { SchedulePack } from "../loader";
import type { AvailabilityInput, SchemaResolution } from "../types";
import type { DoseValidationMap } from "./dose-counter";
import { ageInMonthsAt, durationToMonths, parseDate } from "./duration";
import type { Patient } from "../types";

interface Condition { [key: string]: any }

function matchesProductCounts(
  when: Condition,
  perProduct: Record<string, number>,
  total: number
): boolean {
  const pc = when.product_counts;
  if (!pc) return true;
  for (const [pid, cond] of Object.entries(pc as Record<string, any>)) {
    const n = pid === "_TOTAL" ? total : (perProduct[pid] ?? 0);
    const c = cond as any;
    if (c.equals !== undefined && n !== Number(c.equals)) return false;
    if (c.gte !== undefined && n < Number(c.gte)) return false;
    if (c.lte !== undefined && n > Number(c.lte)) return false;
  }
  return true;
}

function matchesAge(when: Condition, ageMonths: number): boolean {
  const a = when.age;
  if (!a) return true;
  if (a.from && ageMonths < durationToMonths(a.from)) return false;
  if (a.to_before && ageMonths >= durationToMonths(a.to_before)) return false;
  return true;
}

export function resolveSchemas(
  pack: SchedulePack,
  validations: DoseValidationMap,
  patient: Patient,
  evaluationDate: Date,
  availability: AvailabilityInput | undefined
): { packView: SchedulePack; resolutions: SchemaResolution[]; assumptions: string[] } {
  const policy = availability?.policy ?? "TRANSITION";
  const stockList = availability?.products;
  const assumptions: string[] = [];
  if (!stockList) {
    assumptions.push(
      `PCV availability assumed by policy ${policy} (stock not connected).`
    );
  }

  const policiesCfg: any[] =
    (pack.productSelection as any)?.product_selection?.availability_policies ?? [];
  const policyCfg = policiesCfg.find((p: any) => p.id === policy) ?? policiesCfg[0];
  const reserved: any[] = policyCfg?.reserved ?? [];

  const view: SchedulePack = JSON.parse(JSON.stringify(pack));
  const resolutions: SchemaResolution[] = [];
  const ageMonths = ageInMonthsAt(parseDate(patient.birthDate), evaluationDate);

  for (const programId of Object.keys(view.programs as any)) {
    const program: any = (view.programs as any)[programId];
    const schemas: any[] = program?.primary_series?.schemas ?? [];
    if (schemas.length === 0) continue;

    const counterId = program.program?.counter;
    const validDoses = (validations[counterId]?.doses ?? []).filter(
      (d: any) => d.valid && d.doseNumber > 0
    );
    const perProduct: Record<string, number> = {};
    for (const d of validDoses) {
      perProduct[d.productGroupId] = (perProduct[d.productGroupId] ?? 0) + 1;
    }
    const total = validDoses.length;
    const lastProduct = validDoses.length
      ? validDoses[validDoses.length - 1].productGroupId
      : null;

    const available = (pid: string): boolean => {
      if (stockList) return stockList.includes(pid);
      const res = reserved.find((r: any) => r.product_group === pid);
      if (!res) return true;
      if (res.reserve_for === "history_starters") return (perProduct[pid] ?? 0) > 0;
      return true;
    };

    let matched: any = null;
    for (const sch of schemas) {
      const when = sch.when ?? {};
      if (!matchesProductCounts(when, perProduct, total)) continue;
      if (!matchesAge(when, ageMonths)) continue;
      if (when.availability) {
        if (when.availability.includes && !available(when.availability.includes)) continue;
        if (when.availability.excludes && available(when.availability.excludes)) continue;
      }
      matched = sch;
      break;
    }
    if (!matched) continue;

    const requiredPrimaries = Number(matched.required_primaries ?? 0);
    const boosterCount = Number(matched.booster_count ?? 0);
    const givenPrimaries = Math.min(total, requiredPrimaries);
    const remaining = Math.max(0, requiredPrimaries - givenPrimaries);
    const targetProduct: string | null =
      matched.target_product ??
      lastProduct ??
      (matched.prefer_available ?? null);

    const viewProg: any = (view.programs as any)[programId];
    viewProg.primary_series.required_valid_doses = requiredPrimaries;
    if (targetProduct) {
      viewProg.primary_series.preferred_product = targetProduct;
      for (const pol of viewProg.booster_policies ?? []) {
        for (let seq = 1; ; seq++) {
          const cfg = pol[`booster_${seq}`];
          if (!cfg) break;
          if (typeof cfg.product_group === "string" || !cfg.product_group) {
            cfg.product_group = targetProduct;
          }
        }
      }
    }

    const doneAt = requiredPrimaries + boosterCount;
    const rules: any[] = [];
    if (doneAt > 0) {
      rules.push({
        id: `${matched.id}-DONE`,
        when: { counter: { id: counterId, gte: doneAt } },
        then: { action: "complete" }
      });
    }
    if (requiredPrimaries === 0 && boosterCount === 0) {
      rules.push({
        id: `${matched.id}-NONE`,
        when: { counter: { id: counterId, equals: total } },
        then: { action: "none" }
      });
    } else if (remaining > 0) {
      rules.push({
        id: `${matched.id}-MAIN`,
        when: { counter: { id: counterId, equals: total } },
        then: {
          action: "complete_primary",
          doses_needed: remaining,
          booster_policy: matched.booster_policy
        }
      });
    } else if (boosterCount > 0) {
      rules.push({
        id: `${matched.id}-BOOSTER`,
        when: { counter: { id: counterId, equals: total } },
        then: {
          action: "give_booster_if_due",
          booster_sequence: 1,
          booster_policy: matched.booster_policy
        }
      });
    }
    viewProg.catchup_rules = rules;

    resolutions.push({
      programId,
      schemaId: matched.id,
      requiredPrimaries,
      boosterCount,
      targetProduct,
      assumption: stockList ? null : `policy ${policy}`
    });
  }
  return { packView: view, resolutions, assumptions };
}
import type { SchedulePack } from "../loader";
import type {
  Patient,
  AntigenNeed,
  ProductSelectionResult,
  VisitPlan,
  PlannedVisit
} from "../types";
import {
  parseDate,
  formatDate,
  addDurationToDate,
  ageInMonthsAt,
  durationToDays,
  resolveDuration,
  type Duration
} from "./duration";
import {
  isProductEligible,
  productCoversProgram,
  resolveBoosterProduct
} from "./product-selector";

interface RawVisit {
  date: Date;
  productGroupId: string;
  antigens: string[];
  role: string;
  programIds: string[];
  projected: boolean;
}

export function planVisits(
  selection: ProductSelectionResult,
  needs: AntigenNeed[],
  pack: SchedulePack,
  patient: Patient,
  evaluationDate: Date,
  programLastDates: Record<string, string | null>,
  projection: "next" | "full" = "next"
): VisitPlan {
  const warnings: string[] = [];
  const birthDate = parseDate(patient.birthDate);

  const needsById: Record<string, AntigenNeed> = {};
  for (const need of needs) {
    needsById[need.programId] = need;
  }

  const scheduledLastByProgram: Record<string, Date | null> = {};
  for (const [programId, dateStr] of Object.entries(programLastDates)) {
    scheduledLastByProgram[programId] = dateStr ? parseDate(dateStr) : null;
  }

  const productSelection: any = (pack.productSelection as any)?.product_selection ?? {};
  const selectionConfig: any = productSelection.selection ?? {};
  const maxAlignmentDelayDays = durationToDays(
    selectionConfig.max_alignment_delay ?? { days: 0 }
  );

  const productGroups: any[] = (pack.catalog as any).product_groups ?? [];
  const programs: any = pack.programs as any;

  const rawVisits: RawVisit[] = [];
  const plannedPrimaryByProgram: Record<string, number> = {};

  // ---------- primary slots ----------
  for (const slot of selection.primarySlots) {
    const productDates: Array<{
      productGroupId: string;
      coveredProgramIds: string[];
      date: Date;
    }> = [];

    for (const slotProduct of slot.products) {
      let earliest = evaluationDate;

      for (const programId of slotProduct.coveredProgramIds) {
        const need = needsById[programId];
        if (!need) continue;

        const program: any = programs[programId];
        const doseValidity: any[] = program?.primary_series?.dose_validity ?? [];
        const absoluteDoseNumber = need.validDosesReceived + slot.slot;
        const rule = doseValidity.find((r: any) => r.dose === absoluteDoseNumber);
        const lastDate = scheduledLastByProgram[programId] ?? null;

        const programEarliest = calculateEarliestPrimaryDate(
          rule,
          lastDate,
          birthDate,
          evaluationDate
        );

        if (programEarliest > earliest) {
          earliest = programEarliest;
        }
      }

      productDates.push({
        productGroupId: slotProduct.productGroupId,
        coveredProgramIds: slotProduct.coveredProgramIds,
        date: earliest
      });
    }

    if (productDates.length === 0) continue;

    const minDate = productDates.reduce((m, c) => (c.date < m ? c.date : m), productDates[0].date);
    const maxDate = productDates.reduce((m, c) => (c.date > m ? c.date : m), productDates[0].date);
    const diffDays = Math.round((maxDate.getTime() - minDate.getTime()) / 86400000);
    const useCommonDate = diffDays <= maxAlignmentDelayDays;

    for (const pd of productDates) {
      const visitDate = useCommonDate ? maxDate : pd.date;

      rawVisits.push({
        date: visitDate,
        productGroupId: pd.productGroupId,
        antigens: getProductAntigens(productGroups, pd.productGroupId),
        role: "primary",
        programIds: pd.coveredProgramIds,
        projected: false
      });

      for (const programId of pd.coveredProgramIds) {
        scheduledLastByProgram[programId] = visitDate;
        plannedPrimaryByProgram[programId] =
          (plannedPrimaryByProgram[programId] ?? 0) + 1;
      }
    }
  }

  // ---------- boosters required by current needs ----------
  for (const booster of selection.boosterPlans) {
    const need = needsById[booster.programId];
    const program: any = programs[booster.programId];

    if (!program) {
      warnings.push(`Program not found for booster: ${booster.programId}`);
      continue;
    }

    const boosterPolicies: any[] = program.booster_policies ?? [];
    const boosterPolicy =
      boosterPolicies.find((p: any) => p.id === need?.boosterPolicyId) ??
      boosterPolicies[0];

    const boosterConfig = boosterPolicy?.[`booster_${booster.boosterSequence}`];

    if (!boosterConfig) {
      warnings.push(
        `Booster configuration not found for ${booster.programId} booster ${booster.boosterSequence}`
      );
      continue;
    }

    let visitDate = evaluationDate;

    if (boosterConfig.min_age) {
      const minAgeDate = addDurationToDate(birthDate, boosterConfig.min_age);
      if (minAgeDate > visitDate) visitDate = minAgeDate;
    }

    const lastDate = scheduledLastByProgram[booster.programId] ?? null;

    if (lastDate) {
      const intervalDate = boosterIntervalDate(
        boosterConfig,
        booster.boosterSequence,
        lastDate,
        birthDate
      );

      if (intervalDate && intervalDate > visitDate) {
        visitDate = intervalDate;
      }
    } else {
      warnings.push(
        `Missing reference date for booster ${booster.boosterSequence} in program ${booster.programId}`
      );
    }

    const boosterProduct =
      resolveBoosterProduct(
        boosterConfig,
        ageInMonthsAt(birthDate, visitDate)
      ) ?? booster.productGroupId;

    rawVisits.push({
      date: visitDate,
      productGroupId: boosterProduct,
      antigens: getProductAntigens(productGroups, boosterProduct),
      role: booster.role,
      programIds: [booster.programId],
      projected: false
    });

    scheduledLastByProgram[booster.programId] = visitDate;
  }

  // ---------- same-visit antigen overlap unification ----------
  const unified = unifySameDateConflicts(
    rawVisits,
    productGroups,
    programs,
    productSelection,
    needsById,
    birthDate,
    warnings
  );

  // ---------- projection of future boosters ----------
  if (projection === "full") {
    projectFutureBoosters(
      unified,
      needsById,
      programs,
      scheduledLastByProgram,
      plannedPrimaryByProgram,
      productGroups,
      birthDate,
      evaluationDate
    );
  }

  // ---------- group by date ----------
  const source = projection === "full" ? unified : unified.filter(v => !v.projected);
  source.sort((a, b) => a.date.getTime() - b.date.getTime());

  const grouped = new Map<
    string,
    {
      date: Date;
      products: Set<string>;
      antigens: Set<string>;
      roles: Set<string>;
      projected: boolean;
    }
  >();

  for (const visit of source) {
    const key = formatDate(visit.date);

    const existing =
      grouped.get(key) ??
      {
        date: visit.date,
        products: new Set<string>(),
        antigens: new Set<string>(),
        roles: new Set<string>(),
        projected: visit.projected
      };

    existing.products.add(visit.productGroupId);
    for (const antigen of visit.antigens) existing.antigens.add(antigen);
    existing.roles.add(visit.role);
    if (visit.projected) existing.projected = true;

    grouped.set(key, existing);
  }

  const visits: PlannedVisit[] = [];
  let visitNumber = 1;

  for (const [, group] of grouped) {
    const status: PlannedVisit["status"] = group.projected
      ? "PROJECTED"
      : group.date.getTime() <= evaluationDate.getTime()
        ? "DUE_NOW"
        : "DUE_FUTURE";

    visits.push({
      visitNumber,
      date: formatDate(group.date),
      products: Array.from(group.products),
      antigensCovered: Array.from(group.antigens),
      role: Array.from(group.roles).join("+"),
      status
    });

    visitNumber++;
  }

  return { visits, warnings };
}

function unifySameDateConflicts(
  rawVisits: RawVisit[],
  productGroups: any[],
  programs: any,
  productSelection: any,
  needsById: Record<string, AntigenNeed>,
  birthDate: Date,
  warnings: string[]
): RawVisit[] {
  const byDate = new Map<string, RawVisit[]>();

  for (const visit of rawVisits) {
    const key = formatDate(visit.date);
    byDate.set(key, [...(byDate.get(key) ?? []), visit]);
  }

  const result: RawVisit[] = [];

  for (const [, group] of byDate) {
    if (group.length < 2) {
      result.push(...group);
      continue;
    }

    const seen = new Map<string, number>();
    let overlap = false;

    for (const visit of group) {
      for (const antigen of visit.antigens) {
        const count = (seen.get(antigen) ?? 0) + 1;
        seen.set(antigen, count);
        if (count > 1) overlap = true;
      }
    }

    if (!overlap) {
      result.push(...group);
      continue;
    }

    const unionPrograms = Array.from(new Set(group.flatMap(v => v.programIds)));

    const candidate = productGroups.find((product: any) => {
      if (
        !isProductEligible(
          product.id,
          ageInMonthsAt(birthDate, group[0].date),
          productSelection.eligibility ?? []
        )
      ) {
        return false;
      }

      return unionPrograms.every((programId: string) => {
        const program: any = programs[programId];
        const need = needsById[programId];
        if (!program || !need) return false;
        return productCoversProgram(product, need);
      });
    });

    if (candidate) {
      result.push({
        date: group[0].date,
        productGroupId: candidate.id,
        antigens: getProductAntigens(productGroups, candidate.id),
        role: group.map(v => v.role).join("+"),
        programIds: unionPrograms,
        projected: false
      });
    } else {
      warnings.push(
        `Same-visit antigen overlap: no single eligible product covers ${unionPrograms.join(", ")}. Clinician decision required.`
      );
      result.push(...group);
    }
  }

  return result;
}

function projectFutureBoosters(
  visits: RawVisit[],
  needsById: Record<string, AntigenNeed>,
  programs: any,
  scheduledLastByProgram: Record<string, Date | null>,
  plannedPrimaryByProgram: Record<string, number>,
  productGroups: any[],
  birthDate: Date,
  evaluationDate: Date
): void {
  for (const [programId, need] of Object.entries(needsById)) {
    const program: any = programs[programId];
    const policies: any[] = program?.booster_policies ?? [];
    if (policies.length === 0) continue;

    const policy =
      policies.find((p: any) => p.id === need.boosterPolicyId) ?? policies[0];
    if (!policy) continue;

    const required = program?.primary_series?.required_valid_doses ?? 0;
    const projectedPrimaryTotal =
      need.validDosesReceived + (plannedPrimaryByProgram[programId] ?? 0);

    let nextSeq: number | null = null;

    if (need.status === "NEEDS_BOOSTER") {
      nextSeq = (need.boosterSequence ?? 1) + 1;
    } else if (
      need.status === "NEEDS_PRIMARY" &&
      required > 0 &&
      projectedPrimaryTotal >= required
    ) {
      nextSeq = 1;
    }

    if (!nextSeq) continue;

    let refDate = scheduledLastByProgram[programId] ?? null;

    for (let seq = nextSeq; ; seq++) {
      const config = policy[`booster_${seq}`];
      if (!config) break;

      let date = evaluationDate;

      if (config.min_age) {
        const minAgeDate = addDurationToDate(birthDate, config.min_age);
        if (minAgeDate > date) date = minAgeDate;
      }

      const intervalKey =
        seq === 1
          ? "min_interval_after_primary_completion"
          : "min_interval_after_booster_1";

      if (config[intervalKey] && refDate) {
        const interval = resolveDuration(
          config[intervalKey],
          ageInMonthsAt(birthDate, refDate)
        );

        if (interval) {
          const intervalDate = addDurationToDate(refDate, interval);
          if (intervalDate > date) date = intervalDate;
        }
      }

      const projectedProduct =
        resolveBoosterProduct(config, ageInMonthsAt(birthDate, date)) ??
        (typeof config.product_group === "string"
          ? config.product_group
          : "");

      visits.push({
        date,
        productGroupId: projectedProduct,
        antigens: getProductAntigens(productGroups, projectedProduct),
        role: `booster_${seq}`,
        programIds: [programId],
        projected: true
      });

      refDate = date;
      scheduledLastByProgram[programId] = date;
    }
  }
}

function calculateEarliestPrimaryDate(
  rule: any,
  lastDate: Date | null,
  birthDate: Date,
  evaluationDate: Date
): Date {
  let earliest = evaluationDate;

  if (!rule) return earliest;

  if (rule.min_age) {
    const minAgeDate = addDurationToDate(birthDate, rule.min_age);
    if (minAgeDate > earliest) earliest = minAgeDate;
  }

  // POLIO FEATURE 2: never plan before the recommended target age
  if (rule.target_min_age) {
    const targetDate = addDurationToDate(birthDate, rule.target_min_age);
    if (targetDate > earliest) earliest = targetDate;
  }
  
  if (rule.min_interval_from_previous && lastDate) {
    const lastAgeMonths = ageInMonthsAt(birthDate, lastDate);
    const interval = resolveDuration(rule.min_interval_from_previous, lastAgeMonths);

    if (interval) {
      const intervalDate = addDurationToDate(lastDate, interval);
      if (intervalDate > earliest) earliest = intervalDate;
    }
  }

  return earliest;
}

function getProductAntigens(productGroups: any[], productGroupId: string): string[] {
  const product = productGroups.find(p => p.id === productGroupId);
  if (!product) return [];
  return Array.isArray(product.satisfies_antigens) ? product.satisfies_antigens : [];
}

function boosterIntervalDate(
  config: any,
  seq: number,
  lastDate: Date,
  birthDate: Date
): Date | null {
  const raw =
    seq === 1
      ? config.min_interval_after_primary_completion
      : config.min_interval_after_booster_1;

  if (!raw) return null;

  const interval = resolveDuration(raw, ageInMonthsAt(birthDate, lastDate));
  if (!interval) return null;

  return addDurationToDate(lastDate, interval);
}
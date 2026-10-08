import type { SchedulePack } from "../loader";
import type {
  Patient,
  AntigenNeed,
  ProductSelectionResult,
  VisitPlan,
  PlannedVisit,
  PlannedDose,
  ImmunizationRecord
} from "../types";
import {
  parseDate,
  formatDate,
  addDurationToDate,
  ageInMonthsAt,
  durationToDays,
  durationToMonths,
  resolveDuration,
  isAgeBefore,
  type Duration
} from "./duration";
import {
  isProductEligible,
  productCoversProgram,
  resolveBoosterProduct,
  buildPickContext,
  pickProductsForPrograms
} from "./product-selector";
import {
  scheduleWithSpacing,
  getSpacingConstraints,
  constrainedPair,
  liveFlags
} from "./spacing";

interface RawVisit {
  date: Date;
  /** when the dose would be due ignoring spacing rules; decides who waits on a conflict */
  baseDate: Date;
  /** creation order, a stable tie-break */
  order: number;
  kind: "birth" | "primary" | "booster";
  /** booster policy entry this visit comes from (kind "booster") */
  booster?: { config: any; seq: number };
  productGroupId: string;
  antigens: string[];
  role: string;
  programIds: string[];
  /** dose number this visit represents, per program (for amounts and display) */
  doseNumbers: Record<string, number>;
  projected: boolean;
}

// Merge the generic dose rule (base) with the product-qualified rule (overlay).
// The overlay must ADD product-specific targets, never SHADOW the base intervals.
function findDoseRule(
  doseValidity: any[],
  doseNumber: number,
  productGroupId: string
): any {
  const base = doseValidity.find(
    (r: any) => r.dose === doseNumber && !r.product_group
  );
  const overlay = doseValidity.find(
    (r: any) => r.dose === doseNumber && r.product_group === productGroupId
  );
  if (!base) return overlay ?? null;
  if (!overlay) return base;
  const merged: any = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    if (k !== "dose" && k !== "product_group") merged[k] = v;
  }
  return merged;
}

export function planVisits(
  selection: ProductSelectionResult,
  needs: AntigenNeed[],
  pack: SchedulePack,
  patient: Patient,
  history: ImmunizationRecord[],
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

  const recordedLastByProgram: Record<string, Date | null> = {
    ...scheduledLastByProgram
  };

  const productSelection: any = (pack.productSelection as any)?.product_selection ?? {};
  const selectionConfig: any = productSelection.selection ?? {};
  const maxAlignmentDelayDays = durationToDays(
    selectionConfig.max_alignment_delay ?? { days: 0 }
  );

  const productGroups: any[] = (pack.catalog as any).product_groups ?? [];
  const programs: any = pack.programs as any;
  const spacingConstraints = getSpacingConstraints(pack);
  const spacingIsLive = liveFlags(pack);

  const rawVisits: RawVisit[] = [];
  const plannedPrimaryByProgram: Record<string, number> = {};
  const birthOffsetByProgram: Record<string, number> = {};

  // ---------- birth doses ----------
  for (const plan of selection.birthDosePlans ?? []) {
    const planDate = parseDate(plan.date);
    rawVisits.push({
      date: planDate,
      baseDate: planDate,
      order: rawVisits.length,
      kind: "birth",
      productGroupId: plan.productGroupId,
      antigens: getProductAntigens(productGroups, plan.productGroupId),
      role: "birth_dose",
      programIds: [plan.programId],
      doseNumbers: { [plan.programId]: plan.offset },
      projected: false
    });
    scheduledLastByProgram[plan.programId] = planDate;
    plannedPrimaryByProgram[plan.programId] =
      (plannedPrimaryByProgram[plan.programId] ?? 0) + plan.offset;
    birthOffsetByProgram[plan.programId] = plan.offset;
  }

  // ---------- primary slots ----------
  const pickCtx = buildPickContext(pack, needs, birthDate);
  const eligibilityRules: any[] = productSelection.eligibility ?? [];

  // Earliest date for one product in one slot, the programs it can still cover
  // (Rota's age limit etc.), and the dose number it represents for each program.
  const slotProductDate = (
    slotNumber: number,
    productGroupId: string,
    programIds: string[]
  ) => {
    let earliest = evaluationDate;
    const doseNumbers: Record<string, number> = {};
    const doseRules: Record<string, any> = {};

    for (const programId of programIds) {
      const need = needsById[programId];
      if (!need) continue;
      const program: any = programs[programId];
      const doseValidity: any[] = program?.primary_series?.dose_validity ?? [];
      const absoluteDoseNumber =
        need.validDosesReceived +
        (birthOffsetByProgram[programId] ?? 0) +
        slotNumber;
      doseNumbers[programId] = absoluteDoseNumber;
      const rule = findDoseRule(doseValidity, absoluteDoseNumber, productGroupId);
      doseRules[programId] = rule;
      const lastDate = scheduledLastByProgram[programId] ?? null;
      const programEarliest = calculateEarliestPrimaryDate(
        rule,
        lastDate,
        birthDate,
        evaluationDate
      );
      if (programEarliest > earliest) earliest = programEarliest;
    }

    // last day on which every program's age limit (Rota's 24 months, ...) still allows the dose
    let latest: Date | null = null;
    for (const programId of programIds) {
      const limit = doseRules[programId]?.max_age;
      if (!limit) continue;
      const lastDay = addDurationToDate(addDurationToDate(birthDate, limit), { days: -1 });
      if (!latest || lastDay < latest) latest = lastDay;
    }

    const feasible = programIds.filter((programId: string) => {
      const rule = doseRules[programId];
      if (!rule?.max_age) return true;
      if (!isAgeBefore(birthDate, earliest, rule.max_age)) {
        warnings.push(
          `AGE_LIMIT_PREVENTS_DOSE: ${programId} dose ${doseNumbers[programId]} would fall at ${ageInMonthsAt(birthDate, earliest)} months (limit ${durationToMonths(rule.max_age)} months). Not planned.`
        );
        return false;
      }
      return true;
    });

    return { earliest, feasible, doseNumbers, latest };
  };

  for (const slot of selection.primarySlots) {
    const productDates: Array<{
      productGroupId: string;
      coveredProgramIds: string[];
      date: Date;
      doseNumbers: Record<string, number>;
      latest: Date | null;
    }> = [];

    const queue: Array<{
      productGroupId: string;
      coveredProgramIds: string[];
      substituted: boolean;
    }> = slot.products.map(p => ({
      productGroupId: p.productGroupId,
      coveredProgramIds: p.coveredProgramIds,
      substituted: false
    }));

    while (queue.length > 0) {
      const slotProduct = queue.shift()!;
      const { earliest, feasible, doseNumbers, latest } = slotProductDate(
        slot.slot,
        slotProduct.productGroupId,
        slotProduct.coveredProgramIds
      );
      if (feasible.length === 0) continue;

      // The product was chosen with the age on the evaluation date. Re-check it
      // on the day the dose is actually planned (e.g. Penta stops at 3 years).
      if (
        !isProductEligible(
          slotProduct.productGroupId,
          birthDate,
          earliest,
          eligibilityRules
        )
      ) {
        const when = `${formatDate(earliest)} (${ageInMonthsAt(birthDate, earliest)} months)`;
        if (slotProduct.substituted) {
          warnings.push(
            `NO_ELIGIBLE_PRODUCT_AT_DATE: ${slotProduct.productGroupId} is not eligible on ${when}; ${feasible.join(", ")} not planned.`
          );
          continue;
        }
        const pickWarnings: string[] = [];
        const picks = pickProductsForPrograms(
          pickCtx,
          feasible.map(id => needsById[id]).filter(Boolean),
          earliest,
          formatDate(earliest),
          pickWarnings,
          []
        );
        if (picks.length > 0) {
          warnings.push(
            `PRODUCT_SUBSTITUTED_BY_AGE: ${slotProduct.productGroupId} is not eligible on ${when}; using ${picks
              .map(p => p.productGroupId)
              .join("+")} for ${feasible.join(", ")}.`
          );
        }
        for (const w of pickWarnings) warnings.push(`NO_ELIGIBLE_PRODUCT_AT_DATE: ${w}`);
        for (const pick of picks) {
          queue.push({
            productGroupId: pick.productGroupId,
            coveredProgramIds: pick.coveredProgramIds,
            substituted: true
          });
        }
        continue;
      }

      productDates.push({
        productGroupId: slotProduct.productGroupId,
        coveredProgramIds: feasible,
        date: earliest,
        doseNumbers,
        latest
      });
    }

    if (productDates.length === 0) continue;

    // cluster alignment (G33) with spacing gate: constrained pairs never share a visit
    const sortedDates = [...productDates].sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );
    const clusters: Array<typeof sortedDates> = [];
    for (const pd of sortedDates) {
      const lastCluster = clusters[clusters.length - 1];
      if (lastCluster) {
        // the delay is measured from the first (earliest) dose of the cluster, so a
        // chain of doses 15 days apart cannot stretch the visit beyond the maximum
        const firstDate = lastCluster[0].date;
        const gap = Math.round(
          (pd.date.getTime() - firstDate.getTime()) / 86400000
        );
        const withinAgeLimits = lastCluster.every(
          member => !member.latest || member.latest.getTime() >= pd.date.getTime()
        );
        const gateBlocked = lastCluster.some(
          member =>
            constrainedPair(
              spacingConstraints,
              member.productGroupId,
              pd.productGroupId,
              spacingIsLive
            )?.sameDayAllowed === false
        );
        if (gap <= maxAlignmentDelayDays && !gateBlocked && withinAgeLimits) {
          lastCluster.push(pd);
          continue;
        }
      }
      clusters.push([pd]);
    }

    for (const cluster of clusters) {
      const clusterDate = cluster.reduce(
        (m, c) => (c.date > m ? c.date : m),
        cluster[0].date
      );
      for (const pd of cluster) {
        rawVisits.push({
          date: clusterDate,
          baseDate: pd.date,
          order: rawVisits.length,
          kind: "primary",
          productGroupId: pd.productGroupId,
          antigens: getProductAntigens(productGroups, pd.productGroupId),
          role: "primary",
          programIds: pd.coveredProgramIds,
          doseNumbers: pd.doseNumbers,
          projected: false
        });
        for (const programId of pd.coveredProgramIds) {
          scheduledLastByProgram[programId] = clusterDate;
          plannedPrimaryByProgram[programId] =
            (plannedPrimaryByProgram[programId] ?? 0) + 1;
        }
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
      if (intervalDate && intervalDate > visitDate) visitDate = intervalDate;
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
      baseDate: visitDate,
      order: rawVisits.length,
      kind: "booster",
      booster: { config: boosterConfig, seq: booster.boosterSequence },
      productGroupId: boosterProduct,
      antigens: getProductAntigens(productGroups, boosterProduct),
      role: booster.role,
      programIds: [booster.programId],
      doseNumbers: { [booster.programId]: (need?.validDosesReceived ?? 0) + 1 },
      projected: false
    });
    scheduledLastByProgram[booster.programId] = visitDate;
  }

  // ---------- projected boosters join the plan before spacing is applied ----------
  if (projection === "full") {
    rawVisits.push(
      ...projectFutureBoosters(
        needsById,
        programs,
        scheduledLastByProgram,
        plannedPrimaryByProgram,
        productGroups,
        birthDate,
        evaluationDate,
        rawVisits.length
      )
    );
  }

  // ---------- dose intervals + spacing rules, together ----------
  // The earliest a visit may take given its own program's previous dose
  // (recorded, or planned and possibly moved) and the age rules.
  const chainLowerBound = (visit: RawVisit, all: RawVisit[]): Date => {
    if (visit.kind === "birth") return visit.baseDate;
    let bound = evaluationDate;

    for (const programId of visit.programIds) {
      const doseNumber = visit.doseNumbers[programId];
      let prev: RawVisit | null = null;
      for (const other of all) {
        if (other === visit) continue;
        const n = other.doseNumbers[programId];
        if (n === undefined || n >= (doseNumber ?? Infinity)) continue;
        if (
          !prev ||
          n > prev.doseNumbers[programId] ||
          (n === prev.doseNumbers[programId] && other.date > prev.date)
        ) {
          prev = other;
        }
      }
      const prevDate = prev ? prev.date : recordedLastByProgram[programId] ?? null;

      let candidate: Date;
      if (visit.kind === "booster" && visit.booster) {
        candidate = evaluationDate;
        if (visit.booster.config.min_age) {
          const minAgeDate = addDurationToDate(birthDate, visit.booster.config.min_age);
          if (minAgeDate > candidate) candidate = minAgeDate;
        }
        if (prevDate) {
          const intervalDate = boosterIntervalDate(
            visit.booster.config,
            visit.booster.seq,
            prevDate,
            birthDate
          );
          if (intervalDate && intervalDate > candidate) candidate = intervalDate;
        }
      } else {
        const rule = findDoseRule(
          programs[programId]?.primary_series?.dose_validity ?? [],
          doseNumber,
          visit.productGroupId
        );
        candidate = calculateEarliestPrimaryDate(rule, prevDate, birthDate, evaluationDate);
      }
      if (candidate > bound) bound = candidate;
    }
    return bound;
  };

  for (const w of scheduleWithSpacing(rawVisits, history, pack, chainLowerBound)) {
    warnings.push(w);
  }

  // ---------- age limits, on the final dates ----------
  // Spacing and intervals can push a dose past its age limit (Rota: 24 months).
  // Such a dose is dropped, never planned late.
  for (const visit of [...rawVisits]) {
    if (visit.kind === "birth") continue;
    for (const programId of [...visit.programIds]) {
      const doseNumber = visit.doseNumbers[programId];
      const rule = findDoseRule(
        programs[programId]?.primary_series?.dose_validity ?? [],
        doseNumber,
        visit.productGroupId
      );
      if (rule?.max_age && !isAgeBefore(birthDate, visit.date, rule.max_age)) {
        warnings.push(
          `AGE_LIMIT_PREVENTS_DOSE: ${programId} dose ${doseNumber} would fall at ${ageInMonthsAt(birthDate, visit.date)} months (limit ${durationToMonths(rule.max_age)} months). Not planned.`
        );
        visit.programIds = visit.programIds.filter((p: string) => p !== programId);
        delete visit.doseNumbers[programId];
      }
    }
    if (visit.programIds.length === 0) {
      rawVisits.splice(rawVisits.indexOf(visit), 1);
    }
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

  // ---------- group by date ----------
  const source = unified;
  source.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Dose details for display: dose number, category and the prescribed amount
  // when the schedule defines one (e.g. vitamin A 100 000 / 200 000 IU).
  const dosesOf = (visit: RawVisit): PlannedDose[] =>
    visit.programIds.flatMap((programId: string) => {
      const doseNumber = visit.doseNumbers[programId];
      if (doseNumber === undefined) return [];
      const product = productGroups.find((p: any) => p.id === visit.productGroupId);
      const rule = findDoseRule(
        programs[programId]?.primary_series?.dose_validity ?? [],
        doseNumber,
        visit.productGroupId
      );
      const dose: PlannedDose = {
        programId,
        productGroupId: visit.productGroupId,
        doseNumber,
        category: product?.category === "supplement" ? "supplement" : "vaccine"
      };
      if (visit.projected) dose.projected = true;
      if (rule?.dose_amount) {
        dose.amount = {
          value: Number(rule.dose_amount.value),
          unit: String(rule.dose_amount.unit)
        };
      }
      return [dose];
    });

  const grouped = new Map<
    string,
    {
      date: Date;
      products: Set<string>;
      antigens: Set<string>;
      roles: Set<string>;
      doses: Map<string, PlannedDose>;
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
        doses: new Map<string, PlannedDose>(),
        projected: visit.projected
      };
    existing.products.add(visit.productGroupId);
    for (const antigen of visit.antigens) existing.antigens.add(antigen);
    existing.roles.add(visit.role);
    for (const dose of dosesOf(visit)) {
      existing.doses.set(`${dose.programId}|${dose.productGroupId}|${dose.doseNumber}`, dose);
    }
    existing.projected = existing.projected && visit.projected;
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
      status,
      doses: Array.from(group.doses.values())
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

    // Two visits of the same product for the same program on one date are two
    // doses, not an overlap to merge. Keep both and say so.
    const duplicateDose = group.some((a, i) =>
      group.some(
        (b, j) =>
          j > i &&
          a.productGroupId === b.productGroupId &&
          a.programIds.some(programId => b.programIds.includes(programId))
      )
    );
    if (duplicateDose) {
      warnings.push(
        `DUPLICATE_DOSE_SAME_DAY: ${formatDate(group[0].date)} has two doses of the same product for the same program; not merged. Check the plan.`
      );
      result.push(...group);
      continue;
    }

    const unionPrograms = Array.from(new Set(group.flatMap(v => v.programIds)));
    const ownIds = new Set(group.map(v => v.productGroupId));
    const candidates = [
      ...productGroups.filter((p: any) => ownIds.has(p.id)),
      ...productGroups.filter((p: any) => !ownIds.has(p.id))
    ];
    const candidate = candidates.find((product: any) => {
      if (
        !isProductEligible(
          product.id,
          birthDate,
          group[0].date,
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
        baseDate: group.reduce((m, v) => (v.baseDate < m ? v.baseDate : m), group[0].baseDate),
        order: Math.min(...group.map(v => v.order)),
        kind: group[0].kind,
        productGroupId: candidate.id,
        antigens: getProductAntigens(productGroups, candidate.id),
        role: group.map(v => v.role).join("+"),
        programIds: unionPrograms,
        doseNumbers: Object.assign({}, ...group.map(v => v.doseNumbers)),
        projected: group.every(v => v.projected)
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
  needsById: Record<string, AntigenNeed>,
  programs: any,
  scheduledLastByProgram: Record<string, Date | null>,
  plannedPrimaryByProgram: Record<string, number>,
  productGroups: any[],
  birthDate: Date,
  evaluationDate: Date,
  startOrder: number
): RawVisit[] {
  const out: RawVisit[] = [];
  for (const [programId, need] of Object.entries(needsById)) {
    const program: any = programs[programId];
    const policies: any[] = program?.booster_policies ?? [];
    if (policies.length === 0) continue;
    // a variant rule (PCV) can say "no booster on this track"
    if (need.boosterCount === 0) continue;
    const policy =
      policies.find((p: any) => p.id === need.boosterPolicyId) ?? policies[0];
    if (!policy) continue;

    // primaries needed before the booster: the variant's own count when it has one
    const required =
      need.requiredPrimaries ?? program?.primary_series?.required_valid_doses ?? 0;
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
      if (need.boosterCount != null && need.boosterCount > 0 && seq > need.boosterCount) break;
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

      const firstProjectedDose =
        need.status === "NEEDS_BOOSTER"
          ? need.validDosesReceived + 2 // one booster visit is already planned
          : projectedPrimaryTotal + 1;
      out.push({
        date,
        baseDate: date,
        order: startOrder + out.length,
        kind: "booster",
        booster: { config, seq },
        productGroupId: projectedProduct,
        antigens: getProductAntigens(productGroups, projectedProduct),
        role: `booster_${seq}`,
        programIds: [programId],
        doseNumbers: { [programId]: firstProjectedDose + (seq - nextSeq) },
        projected: true
      });
      refDate = date;
      scheduledLastByProgram[programId] = date;
    }
  }
  return out;
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

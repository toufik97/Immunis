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

interface RawVisit {
  date: Date;
  productGroupId: string;
  antigens: string[];
  role: string;
  programIds: string[];
}

export function planVisits(
  selection: ProductSelectionResult,
  needs: AntigenNeed[],
  pack: SchedulePack,
  patient: Patient,
  evaluationDate: Date,
  programLastDates: Record<string, string | null>
): VisitPlan {
  const warnings: string[] = [];
  const rawVisits: RawVisit[] = [];

  const birthDate = parseDate(patient.birthDate);

  const needsById: Record<string, AntigenNeed> = {};

  for (const need of needs) {
    needsById[need.programId] = need;
  }

  const scheduledLastByProgram: Record<string, Date | null> = {};

  for (const [programId, dateStr] of Object.entries(programLastDates)) {
    scheduledLastByProgram[programId] = dateStr ? parseDate(dateStr) : null;
  }

  const productSelection: any =
    (pack.productSelection as any)?.product_selection ?? {};

  const selectionConfig: any = productSelection.selection ?? {};

  const maxAlignmentDelayDays = durationToDays(
    selectionConfig.max_alignment_delay ?? { days: 0 }
  );

  const productGroups: any[] = (pack.catalog as any).product_groups ?? [];

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

        if (!need) {
          continue;
        }

        const program: any = (pack.programs as any)[programId];
        const doseValidity: any[] =
          program?.primary_series?.dose_validity ?? [];

        const absoluteDoseNumber =
          need.validDosesReceived + slot.slot;

        const rule = doseValidity.find(
          (validityRule: any) => validityRule.dose === absoluteDoseNumber
        );

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

    if (productDates.length === 0) {
      continue;
    }

    const minDate = productDates.reduce(
      (min, current) => (current.date < min ? current.date : min),
      productDates[0].date
    );

    const maxDate = productDates.reduce(
      (max, current) => (current.date > max ? current.date : max),
      productDates[0].date
    );

    const differenceDays = Math.round(
      (maxDate.getTime() - minDate.getTime()) / 86400000
    );

    const useCommonDate = differenceDays <= maxAlignmentDelayDays;
    const commonDate = maxDate;

    for (const productDate of productDates) {
      const visitDate = useCommonDate ? commonDate : productDate.date;

      rawVisits.push({
        date: visitDate,
        productGroupId: productDate.productGroupId,
        antigens: getProductAntigens(productGroups, productDate.productGroupId),
        role: "primary",
        programIds: productDate.coveredProgramIds
      });

      for (const programId of productDate.coveredProgramIds) {
        scheduledLastByProgram[programId] = visitDate;
      }
    }
  }

  for (const booster of selection.boosterPlans) {
    const need = needsById[booster.programId];
    const program: any = (pack.programs as any)[booster.programId];

    if (!program) {
      warnings.push(`Program not found for booster: ${booster.programId}`);
      continue;
    }

    const boosterPolicies: any[] = program.booster_policies ?? [];

    const boosterPolicy =
      boosterPolicies.find(policy => policy.id === need?.boosterPolicyId) ??
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

      if (minAgeDate > visitDate) {
        visitDate = minAgeDate;
      }
    }

    const lastDate = scheduledLastByProgram[booster.programId] ?? null;

    if (
      booster.boosterSequence === 1 &&
      boosterConfig.min_interval_after_primary_completion
    ) {
      if (lastDate) {
        const intervalDate = addDurationToDate(
          lastDate,
          boosterConfig.min_interval_after_primary_completion
        );

        if (intervalDate > visitDate) {
          visitDate = intervalDate;
        }
      } else {
        warnings.push(
          `Missing last primary dose date for booster 1 in program ${booster.programId}`
        );
      }
    }

    if (
      booster.boosterSequence === 2 &&
      boosterConfig.min_interval_after_booster_1
    ) {
      if (lastDate) {
        const intervalDate = addDurationToDate(
          lastDate,
          boosterConfig.min_interval_after_booster_1
        );

        if (intervalDate > visitDate) {
          visitDate = intervalDate;
        }
      } else {
        warnings.push(
          `Missing booster 1 date for booster 2 in program ${booster.programId}`
        );
      }
    }

    rawVisits.push({
      date: visitDate,
      productGroupId: booster.productGroupId,
      antigens: getProductAntigens(productGroups, booster.productGroupId),
      role: booster.role,
      programIds: [booster.programId]
    });

    scheduledLastByProgram[booster.programId] = visitDate;
  }

  const grouped = new Map<
    string,
    {
      date: Date;
      products: Set<string>;
      antigens: Set<string>;
      roles: Set<string>;
    }
  >();

  rawVisits.sort((a, b) => a.date.getTime() - b.date.getTime());

  for (const visit of rawVisits) {
    const key = formatDate(visit.date);

    const existing =
      grouped.get(key) ??
      {
        date: visit.date,
        products: new Set<string>(),
        antigens: new Set<string>(),
        roles: new Set<string>()
      };

    existing.products.add(visit.productGroupId);

    for (const antigen of visit.antigens) {
      existing.antigens.add(antigen);
    }

    existing.roles.add(visit.role);

    grouped.set(key, existing);
  }

  const visits: PlannedVisit[] = [];
  let visitNumber = 1;

  for (const [, group] of grouped) {
    visits.push({
      visitNumber,
      date: formatDate(group.date),
      products: Array.from(group.products),
      antigensCovered: Array.from(group.antigens),
      role: Array.from(group.roles).join("+"),
      status:
        group.date.getTime() <= evaluationDate.getTime()
          ? "DUE_NOW"
          : "DUE_FUTURE"
    });

    visitNumber++;
  }

  return {
    visits,
    warnings
  };
}

function calculateEarliestPrimaryDate(
  rule: any,
  lastDate: Date | null,
  birthDate: Date,
  evaluationDate: Date
): Date {
  let earliest = evaluationDate;

  if (!rule) {
    return earliest;
  }

  if (rule.min_age) {
    const minAgeDate = addDurationToDate(birthDate, rule.min_age);

    if (minAgeDate > earliest) {
      earliest = minAgeDate;
    }
  }

  if (rule.min_interval_from_previous && lastDate) {
    const lastAgeMonths = ageInMonthsAt(birthDate, lastDate);

    const interval = resolveDuration(
      rule.min_interval_from_previous,
      lastAgeMonths
    );

    if (interval) {
      const intervalDate = addDurationToDate(lastDate, interval);

      if (intervalDate > earliest) {
        earliest = intervalDate;
      }
    }
  }

  return earliest;
}

function getProductAntigens(
  productGroups: any[],
  productGroupId: string
): string[] {
  const product = productGroups.find(p => p.id === productGroupId);

  if (!product) {
    return [];
  }

  return Array.isArray(product.satisfies_antigens)
    ? product.satisfies_antigens
    : [];
}
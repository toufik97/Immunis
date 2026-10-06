import type { SchedulePack } from "../loader";
import type {
  Patient,
  AntigenNeed,
  ProductSelectionResult,
  PrimarySlotPlan,
  BoosterPlan,
  SlotProduct,
  BirthDosePlan
} from "../types";
import type { DoseValidationMap } from "./dose-counter";
import {
  parseDate,
  formatDate,
  durationToMonths,
  ageThresholdDate,
  isAgeAtLeast,
  isAgeBefore
} from "./duration";

export function selectProducts(
  needs: AntigenNeed[],
  pack: SchedulePack,
  patient: Patient,
  evaluationDate: Date,
  validations?: DoseValidationMap
): ProductSelectionResult {
  const reasoning: string[] = [];
  const warnings: string[] = [];

  const productSelection: any =
    (pack.productSelection as any)?.product_selection ?? {};

  const selectionConfig: any = productSelection.selection ?? {};
  const eligibilityRules: any[] = productSelection.eligibility ?? [];
  const ranking: string[] = productSelection.product_ranking ?? [];
  
  const preferences: any[] = productSelection.preferences ?? [];
  
  const coverageReward = Number(selectionConfig.coverage_reward ?? 100);
  const unneededPenalty = Number(selectionConfig.unneeded_program_penalty ?? 200);

  const birthDate = parseDate(patient.birthDate);

  const productGroups: any[] = (pack.catalog as any).product_groups ?? [];
  
  const plannableGroups = productGroups.filter(
    (g: any) => (g?.clinical?.availability ?? "current") !== "legacy"
  );
  const primaryNeeds = needs.filter(
    need =>
      need.status === "NEEDS_PRIMARY" &&
      need.dosesNeeded > 0 &&
      need.antigenTargets.length > 0
  );
  
  const needsById: Record<string, AntigenNeed> = {};
  for (const n of needs) {
    needsById[n.programId] = n;
  }

  const pickCtx = buildPickContext(pack, needs, birthDate);

  const primarySlots: PrimarySlotPlan[] = [];
  const boosterPlans: BoosterPlan[] = [];

  const remainingByProgram: Record<string, number> = {};
  for (const need of primaryNeeds) {
    remainingByProgram[need.programId] = need.dosesNeeded;
  }

  // ---------- birth doses (HB_MONO / VPO0 inside the first 4 weeks) ----------
  const birthDosePlans: BirthDosePlan[] = [];

  for (const need of primaryNeeds) {
    const program: any = (pack.programs as any)[need.programId];
    const birthDose = program?.primary_series?.birth_dose;
    if (!birthDose) continue;
    if (need.validDosesReceived !== 0) continue;

    // A birth dose that counts as dose 0 (VPO0) is not in validDosesReceived,
    // so look for it in the validated history before planning it again.
    const alreadyGivenAsDoseZero = (validations?.[need.counterId]?.doses ?? []).some(
      (d: any) => d.doseNumber === 0 && d.valid
    );
    if (alreadyGivenAsDoseZero) continue;

    if (!isAgeBefore(birthDate, evaluationDate, birthDose.plan_if_age_below)) {
      continue;
    }

    const offset = Number(birthDose.counts_as_dose ?? 1);

    birthDosePlans.push({
      programId: need.programId,
      productGroupId: birthDose.product_group,
      date: formatDate(evaluationDate),
      offset
    });

    remainingByProgram[need.programId] = Math.max(
      0,
      need.dosesNeeded - offset
    );
  }

  const maxSlots = primaryNeeds.length
    ? Math.max(...primaryNeeds.map(need => remainingByProgram[need.programId]))
    : 0;

  for (let slot = 1; slot <= maxSlots; slot++) {
    const neededNow = primaryNeeds.filter(
      need => remainingByProgram[need.programId] > 0
    );

    if (neededNow.length === 0) {
      break;
    }

    const slotProducts = pickProductsForPrograms(
      pickCtx,
      neededNow,
      evaluationDate,
      `slot ${slot}`,
      warnings,
      reasoning
    );
    for (const sp of slotProducts) {
      for (const programId of sp.coveredProgramIds) {
        remainingByProgram[programId] = Math.max(
          0,
          remainingByProgram[programId] - 1
        );
      }
    }
    if (slotProducts.length > 0) {
      primarySlots.push({
        slot,
        products: slotProducts
      });
    }
  }

  for (const need of needs) {
    if (need.status !== "NEEDS_BOOSTER") {
      continue;
    }

    const program: any = (pack.programs as any)[need.programId];

    if (!program) {
      warnings.push(`Program not found for booster need: ${need.programId}`);
      continue;
    }

    const boosterPolicies: any[] = program.booster_policies ?? [];

    const boosterPolicy =
      boosterPolicies.find(
        policy => policy.id === need.boosterPolicyId
      ) ?? boosterPolicies[0];

    if (!boosterPolicy) {
      warnings.push(`No booster policy found for program ${need.programId}`);
      continue;
    }

    const boosterSequence = need.boosterSequence ?? 1;
    const boosterConfig = boosterPolicy[`booster_${boosterSequence}`];

    if (!boosterConfig?.product_group) {
      warnings.push(
        `Booster ${boosterSequence} configuration missing product_group in program ${need.programId}`
      );
      continue;
    }

    boosterPlans.push({
      programId: need.programId,
      productGroupId:
        typeof boosterConfig.product_group === "string"
          ? boosterConfig.product_group
          : "",
      boosterSequence,
      role: `booster_${boosterSequence}`
    });

    reasoning.push(
      `Booster ${boosterSequence} needed for ${need.programId}: selected ${
        typeof boosterConfig.product_group === "string"
          ? boosterConfig.product_group
          : "product chosen by age at dose"
      }`
    );
  }

  return {
    primarySlots,
    boosterPlans,
    birthDosePlans,
    reasoning,
    warnings,
    strategy: selectionConfig.mode ?? "generic_program_coverage"
  };
}

export interface PickContext {
  pack: SchedulePack;
  needs: AntigenNeed[];
  needsById: Record<string, AntigenNeed>;
  birthDate: Date;
  productGroups: any[];
  plannableGroups: any[];
  eligibilityRules: any[];
  ranking: string[];
  preferences: any[];
  coverageReward: number;
  unneededPenalty: number;
}

export function buildPickContext(
  pack: SchedulePack,
  needs: AntigenNeed[],
  birthDate: Date
): PickContext {
  const productSelection: any =
    (pack.productSelection as any)?.product_selection ?? {};
  const selectionConfig: any = productSelection.selection ?? {};
  const productGroups: any[] = (pack.catalog as any).product_groups ?? [];
  const needsById: Record<string, AntigenNeed> = {};
  for (const n of needs) needsById[n.programId] = n;
  return {
    pack,
    needs,
    needsById,
    birthDate,
    productGroups,
    plannableGroups: productGroups.filter(
      (g: any) => (g?.clinical?.availability ?? "current") !== "legacy"
    ),
    eligibilityRules: productSelection.eligibility ?? [],
    ranking: productSelection.product_ranking ?? [],
    preferences: productSelection.preferences ?? [],
    coverageReward: Number(selectionConfig.coverage_reward ?? 100),
    unneededPenalty: Number(selectionConfig.unneeded_program_penalty ?? 200)
  };
}

/**
 * Greedy product choice for a set of programs that each need one dose at `atDate`.
 * Eligibility is judged at `atDate`, so the same function serves the first pass
 * (evaluation date) and the planner's re-check at a visit's own date.
 */
export function pickProductsForPrograms(
  ctx: PickContext,
  neededNow: AntigenNeed[],
  atDate: Date,
  label: string,
  warnings: string[],
  reasoning: string[]
): SlotProduct[] {
  const {
    pack, needs, needsById, birthDate, productGroups, plannableGroups,
    eligibilityRules, ranking, preferences, coverageReward, unneededPenalty
  } = ctx;
  const Label = label.charAt(0).toUpperCase() + label.slice(1);
  const remainingProgramIds = new Set(neededNow.map(need => need.programId));
  const slotProducts: SlotProduct[] = [];

  while (remainingProgramIds.size > 0) {
    const candidates = plannableGroups.filter(product => {
      if (!isProductEligible(product.id, birthDate, atDate, eligibilityRules)) {
        return false;
      }

      return neededNow.some(
        need =>
          remainingProgramIds.has(need.programId) &&
          productCoversProgram(product, need)
      );
    });

    if (candidates.length === 0) {
      warnings.push(
        `No eligible product found for ${label} and remaining programs: ${Array.from(
          remainingProgramIds
        ).join(", ")}`
      );
      break;
    }

    let bestProduct: any = null;
    let bestCovered: AntigenNeed[] = [];
    let bestScore = -Infinity;

    for (const product of candidates) {
      const coveredNeeded = neededNow.filter(
        need =>
          remainingProgramIds.has(need.programId) &&
          productCoversProgram(product, need)
      );

      if (coveredNeeded.length === 0) {
        continue;
      }

      const coveredUnneeded = needs.filter(
        need =>
          !remainingProgramIds.has(need.programId) &&
          need.antigenTargets.length > 0 &&
          productCoversProgram(product, need)
      );

      const rankIndex = ranking.indexOf(product.id);
      const rankBonus = rankIndex === -1 ? 0 : ranking.length - rankIndex;
      
      const preferredOf = (needId: string): string | null => {
        const n = needsById[needId];
        if (n?.targetProduct) return n.targetProduct;
        const prog: any = (pack.programs as any)[needId];
        return prog?.primary_series?.preferred_product ?? null;
      };
      const prefBonus = coveredNeeded.some(
        n => preferredOf(n.programId) === product.id
      )
        ? 1000
        : 0;

      const score =
        coveredNeeded.length * coverageReward -
        coveredUnneeded.length * unneededPenalty +
        rankBonus + prefBonus +
        preferenceBonus(product.id, neededNow, preferences);

      if (score > bestScore) {
        bestScore = score;
        bestProduct = product;
        bestCovered = coveredNeeded;
      }
    }

    if (!bestProduct) {
      warnings.push(`Unable to select a product for ${label}`);
      break;
    }

    slotProducts.push({
      productGroupId: bestProduct.id,
      coveredProgramIds: bestCovered.map(need => need.programId)
    });

    for (const coveredNeed of bestCovered) {
      remainingProgramIds.delete(coveredNeed.programId);
    }

    reasoning.push(
      `${Label}: selected ${bestProduct.id} covering ${bestCovered
        .map(need => need.programId)
        .join(", ")}`
    );
  }
  // ---------- merge antigen-overlapping products within the slot ----------
  let didMerge = true;
  while (didMerge) {
    didMerge = false;

    outer: for (let i = 0; i < slotProducts.length; i++) {
      for (let j = i + 1; j < slotProducts.length; j++) {
        const a = slotProducts[i];
        const b = slotProducts[j];

        const antigensOf = (id: string): string[] => {
          const p = productGroups.find((x: any) => x.id === id);
          return Array.isArray(p?.satisfies_antigens)
            ? p.satisfies_antigens
            : [];
        };

        const shared = antigensOf(a.productGroupId).some(ag =>
          antigensOf(b.productGroupId).includes(ag)
        );
        if (!shared) continue;

        const unionProgramIds = Array.from(
          new Set([...a.coveredProgramIds, ...b.coveredProgramIds])
        );

        const candidate = plannableGroups.find((product: any) => {
          if (!isProductEligible(product.id, birthDate, atDate, eligibilityRules)) {
            return false;
          }
          return unionProgramIds.every((pid: string) => {
            const nd = needsById[pid];
            return nd ? productCoversProgram(product, nd) : false;
          });
        });

        if (candidate) {
          slotProducts.splice(j, 1);
          slotProducts[i] = {
            productGroupId: candidate.id,
            coveredProgramIds: unionProgramIds
          };
          reasoning.push(
            `${Label}: merged overlapping ${a.productGroupId}+${b.productGroupId} into ${candidate.id}`
          );
          didMerge = true;
          break outer;
        }
      }
    }
  }

  return slotProducts;
}

/**
 * Is the product allowed for a patient born on `birthDate`, given on `date`?
 * Dates, not integer months, so week-based limits are exact.
 */
export function isProductEligible(
  productGroupId: string,
  birthDate: Date,
  date: Date,
  eligibilityRules: any[]
): boolean {
  const rule = eligibilityRules.find(
    eligibility => eligibility.product_group === productGroupId
  );

  if (!rule) {
    return true;
  }

  if (rule.min_age && !isAgeAtLeast(birthDate, date, rule.min_age)) {
    return false;
  }

  if (rule.max_age) {
    if (rule.max_age.exclusive === true) {
      if (!isAgeBefore(birthDate, date, rule.max_age)) {
        return false;
      }
    } else {
      // inclusive limit: still eligible on the day the person turns max_age
      if (date.getTime() > ageThresholdDate(birthDate, rule.max_age).getTime()) {
        return false;
      }
    }
  }

  return true;
}

export function productCoversProgram(product: any, need: AntigenNeed): boolean {
  const satisfies: string[] = Array.isArray(product.satisfies_antigens)
    ? product.satisfies_antigens
    : [];

  return need.antigenTargets.some(antigen =>
    satisfies.includes(antigen)
  );
}
function preferenceBonus(
  productId: string,
  neededNow: AntigenNeed[],
  preferences: any[]
): number {
  let bonus = 0;

  for (const pref of preferences) {
    const when = pref?.when ?? {};
    const then = pref?.then ?? {};

    if (then.prefer_product !== productId) {
      continue;
    }

    if (
      when.program_needed &&
      !neededNow.some(n => n.programId === when.program_needed)
    ) {
      continue;
    }

    bonus += Number(then.bonus ?? 0);
  }

  return bonus;
}

export function resolveBoosterProduct(
  config: any,
  ageMonthsAtDose: number
): string | null {
  const pg = config?.product_group;

  if (typeof pg === "string") {
    return pg;
  }

  if (pg?.conditional) {
    for (const branch of pg.conditional) {
      const c = branch?.when?.age_at_dose;
      if (!c) continue;

      let matches = true;

      if (c.from && ageMonthsAtDose < durationToMonths(c.from)) {
        matches = false;
      }
      if (c.to_before && ageMonthsAtDose >= durationToMonths(c.to_before)) {
        matches = false;
      }

      if (matches) {
        return branch.product ?? null;
      }
    }
  }

  return null;
}
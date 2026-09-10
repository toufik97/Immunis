import type { SchedulePack } from "../loader";
import type {
  Patient,
  AntigenNeed,
  ProductSelectionResult,
  PrimarySlotPlan,
  BoosterPlan,
  SlotProduct
} from "../types";
import { parseDate, ageInMonthsAt, durationToMonths } from "./duration";

export function selectProducts(
  needs: AntigenNeed[],
  pack: SchedulePack,
  patient: Patient,
  evaluationDate: Date
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
  const ageMonths = ageInMonthsAt(birthDate, evaluationDate);

  const productGroups: any[] = (pack.catalog as any).product_groups ?? [];

  const primaryNeeds = needs.filter(
    need =>
      need.status === "NEEDS_PRIMARY" &&
      need.dosesNeeded > 0 &&
      need.antigenTargets.length > 0
  );

  const primarySlots: PrimarySlotPlan[] = [];
  const boosterPlans: BoosterPlan[] = [];

  const remainingByProgram: Record<string, number> = {};

  for (const need of primaryNeeds) {
    remainingByProgram[need.programId] = need.dosesNeeded;
  }

  const maxSlots = primaryNeeds.length
    ? Math.max(...primaryNeeds.map(need => need.dosesNeeded))
    : 0;

  for (let slot = 1; slot <= maxSlots; slot++) {
    const neededNow = primaryNeeds.filter(
      need => remainingByProgram[need.programId] > 0
    );

    if (neededNow.length === 0) {
      break;
    }

    const remainingProgramIds = new Set(
      neededNow.map(need => need.programId)
    );

    const slotProducts: SlotProduct[] = [];

    while (remainingProgramIds.size > 0) {
      const candidates = productGroups.filter(product => {
        if (!isProductEligible(product.id, ageMonths, eligibilityRules)) {
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
          `No eligible product found for slot ${slot} and remaining programs: ${Array.from(
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

        const score =
          coveredNeeded.length * coverageReward -
          coveredUnneeded.length * unneededPenalty +
          rankBonus +
          preferenceBonus(product.id, neededNow, preferences);

        if (score > bestScore) {
          bestScore = score;
          bestProduct = product;
          bestCovered = coveredNeeded;
        }
      }

      if (!bestProduct) {
        warnings.push(`Unable to select a product for slot ${slot}`);
        break;
      }

      slotProducts.push({
        productGroupId: bestProduct.id,
        coveredProgramIds: bestCovered.map(need => need.programId)
      });

      for (const coveredNeed of bestCovered) {
        remainingProgramIds.delete(coveredNeed.programId);
        remainingByProgram[coveredNeed.programId] = Math.max(
          0,
          remainingByProgram[coveredNeed.programId] - 1
        );
      }

      reasoning.push(
        `Slot ${slot}: selected ${bestProduct.id} covering ${bestCovered
          .map(need => need.programId)
          .join(", ")}`
      );
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
      productGroupId: boosterConfig.product_group,
      boosterSequence,
      role: `booster_${boosterSequence}`
    });

    reasoning.push(
      `Booster ${boosterSequence} needed for ${need.programId}: selected ${boosterConfig.product_group}`
    );
  }

  return {
    primarySlots,
    boosterPlans,
    reasoning,
    warnings,
    strategy: selectionConfig.mode ?? "generic_program_coverage"
  };
}

export function isProductEligible(
  productGroupId: string,
  ageMonths: number,
  eligibilityRules: any[]
): boolean {
  const rule = eligibilityRules.find(
    eligibility => eligibility.product_group === productGroupId
  );

  if (!rule) {
    return true;
  }

  if (rule.min_age) {
    const minAgeMonths = durationToMonths(rule.min_age);

    if (ageMonths < minAgeMonths) {
      return false;
    }
  }

  if (rule.max_age) {
    const maxAgeMonths = durationToMonths(rule.max_age);

    if (rule.max_age.exclusive === true) {
      if (ageMonths >= maxAgeMonths) {
        return false;
      }
    } else {
      if (ageMonths > maxAgeMonths) {
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
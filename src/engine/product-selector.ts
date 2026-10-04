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
import { parseDate, formatDate, ageInMonthsAt, durationToMonths } from "./duration";

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

    const windowMonths = durationToMonths(birthDose.plan_if_age_below);
    if (ageMonths >= windowMonths) continue;

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

    const remainingProgramIds = new Set(
      neededNow.map(need => need.programId)
    );

    const slotProducts: SlotProduct[] = [];

    while (remainingProgramIds.size > 0) {
      const candidates = plannableGroups.filter(product => {
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
        
        const preferredOf = (needId: string): string | null => {
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
            if (!isProductEligible(product.id, ageMonths, eligibilityRules)) {
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
              `Slot ${slot}: merged overlapping ${a.productGroupId}+${b.productGroupId} into ${candidate.id}`
            );
            didMerge = true;
            break outer;
          }
        }
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
      `Booster ${boosterSequence} needed for ${need.programId}: selected ${boosterConfig.product_group}`
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
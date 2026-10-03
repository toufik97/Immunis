import type { SchedulePack } from "../loader";
import type { ImmunizationRecord } from "../types";
import { parseDate, formatDate, addDurationToDate, durationToDays } from "./duration";

interface RawVisitLike {
  date: Date;
  productGroupId: string;
  [key: string]: any;
}

export function applyLiveSpacing(
  rawVisits: RawVisitLike[],
  history: ImmunizationRecord[],
  pack: SchedulePack
): string[] {
  const rules: any[] = (pack as any).spacing?.spacing_rules ?? [];
  if (!Array.isArray(rules)) return [];

  const rule = rules.find((r: any) => r?.applies_when?.both_live === true);
  if (!rule) return [];

  const minGap = rule.min_gap ?? { days: 28 };
  const minGapDays = durationToDays(minGap);
  const sameDayAllowed = rule.same_day_allowed !== false;
  const exemptions: any[] = rule.exemptions ?? [];

  const productGroups: any[] = (pack as any).catalog?.product_groups ?? [];
  const isLive: Record<string, boolean> = {};
  for (const g of productGroups) {
    isLive[g.id] = g?.clinical?.live === true;
  }

  const exempt = (a: string, b: string): boolean =>
    exemptions.some((ex: any) => {
      if (ex && ex.product_a && ex.product_b) {
        return (
          (ex.product_a === a && ex.product_b === b) ||
          (ex.product_a === b && ex.product_b === a)
        );
      }
      if (Array.isArray(ex)) {
        return (ex[0] === a && ex[1] === b) || (ex[0] === b && ex[1] === a);
      }
      return false;
    });

  const events = history
    .filter(rec => isLive[rec.productGroupId])
    .map(rec => ({
      date: parseDate(rec.administeredOn),
      productGroupId: rec.productGroupId
    }));

  const warnings: string[] = [];

  for (const visit of rawVisits) {
    if (!isLive[visit.productGroupId]) continue;

    let guard = 0;
    let shifted = true;

    while (shifted && guard < 12) {
      shifted = false;
      guard++;

      for (const ev of events) {
        if (exempt(ev.productGroupId, visit.productGroupId)) continue;

        const gapDays = Math.round(
          (visit.date.getTime() - ev.date.getTime()) / 86400000
        );

        if (gapDays === 0 && sameDayAllowed) continue;

        if (gapDays > 0 && gapDays < minGapDays) {
          const newDate = addDurationToDate(ev.date, minGap);
          warnings.push(
            `LIVE_SPACING_SHIFT: ${visit.productGroupId} moved from ${formatDate(visit.date)} to ${formatDate(newDate)} (live-vaccine rule: same day or >= ${minGapDays} days).`
          );
          visit.date = newDate;
          shifted = true;
        }
      }
    }
  }

  return warnings;
}
export interface LiveSpacingAdjuster {
  adjust(productGroupId: string, date: Date): { date: Date; warnings: string[] };
}

export function createLiveSpacingAdjuster(
  history: ImmunizationRecord[],
  pack: SchedulePack
): LiveSpacingAdjuster {
  const rules: any[] = (pack as any).spacing?.spacing_rules ?? [];
  const rule = Array.isArray(rules)
    ? rules.find((r: any) => r?.applies_when?.both_live === true)
    : undefined;

  const productGroups: any[] = (pack as any).catalog?.product_groups ?? [];
  const isLive: Record<string, boolean> = {};
  for (const g of productGroups) isLive[g.id] = g?.clinical?.live === true;

  if (!rule) {
    return { adjust: (_p: string, d: Date) => ({ date: d, warnings: [] }) };
  }

  const minGap = rule.min_gap ?? { days: 28 };
  const minGapDays = durationToDays(minGap);
  const sameDayAllowed = rule.same_day_allowed !== false;
  const exemptions: any[] = rule.exemptions ?? [];

  const exempt = (a: string, b: string): boolean =>
    exemptions.some((ex: any) => {
      if (ex && ex.product_a && ex.product_b) {
        return (
          (ex.product_a === a && ex.product_b === b) ||
          (ex.product_a === b && ex.product_b === a)
        );
      }
      if (Array.isArray(ex)) {
        return (ex[0] === a && ex[1] === b) || (ex[0] === b && ex[1] === a);
      }
      return false;
    });

  const events = history
    .filter(rec => isLive[rec.productGroupId])
    .map(rec => ({
      date: parseDate(rec.administeredOn),
      productGroupId: rec.productGroupId
    }));

  return {
    adjust(productGroupId: string, date: Date) {
      const warnings: string[] = [];
      if (!isLive[productGroupId]) return { date, warnings };

      let current = date;
      let guard = 0;
      let shifted = true;

      while (shifted && guard < 12) {
        shifted = false;
        guard++;
        for (const ev of events) {
          if (exempt(ev.productGroupId, productGroupId)) continue;
          const gapDays = Math.round(
            (current.getTime() - ev.date.getTime()) / 86400000
          );
          if (gapDays === 0 && sameDayAllowed) continue;
          if (gapDays > 0 && gapDays < minGapDays) {
            const newDate = addDurationToDate(ev.date, minGap);
            warnings.push(
              `LIVE_SPACING_SHIFT: ${productGroupId} moved from ${formatDate(current)} to ${formatDate(newDate)} (live-vaccine rule: same day or >= ${minGapDays} days).`
            );
            current = newDate;
            shifted = true;
          }
        }
      }
      return { date: current, warnings };
    }
  };
}
import type { SchedulePack } from "../infra/packs/loader";
import type { DoseRecord } from "../domain/encounter";
import { canonicalProductId } from "./evaluate-child";

export interface SpacingIssue {
  doseIndex: number;
  productGroupId: string;
  administeredOn: string;
  code: "SPACING_VIOLATION";
  message: string;
  ruleId: string;
}

/** Civil days between two YYYY-MM-DD dates. */
function gapDays(a: string, b: string): number {
  const t = (s: string): number =>
    Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round(Math.abs(t(a) - t(b)) / 86_400_000);
}

/** min_gap duration → days (days/weeks exact; months ≈ 30, years ≈ 365). */
function minGapDays(rule: { min_gap?: { days?: number; weeks?: number; months?: number; years?: number } }): number {
  const g = rule.min_gap ?? { days: 28 };
  if (typeof g.days === "number") return g.days;
  if (typeof g.weeks === "number") return g.weeks * 7;
  if (typeof g.months === "number") return g.months * 30;
  if (typeof g.years === "number") return g.years * 365;
  return 28;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/**
 * Saving-time spacing check (the record gate's second half).
 * Reads the same spacing_rules the planner uses, so anything recorded
 * exactly as planned passes by construction — the two can never disagree.
 * Only incoming (new) doses are ever blamed: history already happened and
 * the planner likewise only moves future dates.
 */
export function checkSpacing(
  prior: DoseRecord[],
  incoming: { dose: DoseRecord; index: number }[],
  pack: SchedulePack
): SpacingIssue[] {
  const live = new Set(
    (pack.catalog.product_groups ?? []).filter((g) => g?.clinical?.live === true).map((g) => g.id)
  );
  const canon = (id: string): string => canonicalProductId(pack, id);
  const rules = pack.spacing?.spacing_rules ?? [];
  const issues: SpacingIssue[] = [];
  const blamed = new Set<number>();

  // Blame at most one issue per incoming dose (first violation wins).
  function blame(index: number, productGroupId: string, administeredOn: string, ruleId: string, message: string): void {
    if (blamed.has(index)) return;
    blamed.add(index);
    issues.push({ doseIndex: index, productGroupId, administeredOn, code: "SPACING_VIOLATION", message, ruleId });
  }

  // Does this rule constrain products a and b (after exemptions)?
  function ruleFor(a: string, b: string): { minDays: number; sameDay: boolean; move?: string } | null {
    for (const r of rules) {
      const when = r?.applies_when ?? {};
      let matches = false;
      if (when?.both_live === true) {
        matches = live.has(a) && live.has(b);
      } else if (Array.isArray(when?.pairs)) {
        matches = when.pairs.some((p) => (p?.product_a === a && p?.product_b === b) || (p?.product_a === b && p?.product_b === a));
      }
      if (!matches) continue;
      const exempt = (r?.exemptions ?? []).some(
        (p) => (p?.product_a === a && p?.product_b === b) || (p?.product_a === b && p?.product_b === a)
      );
      if (exempt) continue;
      return {
        minDays: minGapDays(r),
        sameDay: r?.same_day_allowed !== false,
        move: typeof r?.move_on_tie === "string" ? r.move_on_tie : undefined,
      };
    }
    return null;
  }

  const credited = prior.map((d) => ({ product: canon(d.productGroupId), date: d.administeredOn }));
  const fresh = incoming.map(({ dose, index }) => ({ product: canon(dose.productGroupId), date: dose.administeredOn, index, raw: dose.productGroupId }));

  // Incoming vs history: the new dose is always the blamed side.
  for (const f of fresh) {
    for (const o of credited) {
      if (f.product === o.product) continue;
      const rule = ruleFor(f.product, o.product);
      if (!rule) continue;
      const gap = gapDays(f.date, o.date);
      if (gap < rule.minDays && !(gap === 0 && rule.sameDay)) {
        blame(f.index, f.raw, f.date, pairKey(f.product, o.product), `SPACING_VIOLATION: ${f.product} too close to ${o.product} (${gap} days apart, minimum ${rule.minDays} days).`);
      }
    }
  }

  // Incoming vs incoming (same payload): blame the later date; on a tie the
  // product the rule book names as "the one to move", else the second row.
  for (let x = 0; x < fresh.length; x++) {
    for (let y = x + 1; y < fresh.length; y++) {
      const a = fresh[x];
      const b = fresh[y];
      if (a.product === b.product) continue;
      const rule = ruleFor(a.product, b.product);
      if (!rule) continue;
      const gap = gapDays(a.date, b.date);
      if (!(gap < rule.minDays && !(gap === 0 && rule.sameDay))) continue;
      // Later date is to blame; on a tie the rule book's move_on_tie product, else the second row.
      const c = a.date === b.date ? (rule.move === a.product ? a : b) : a.date > b.date ? a : b;
      blame(c.index, c.raw, c.date, pairKey(a.product, b.product), `SPACING_VIOLATION: ${c.product} too close to ${(c === a ? b : a).product} (${gap} days apart, minimum ${rule.minDays} days).`);
    }
  }
  return issues;
}

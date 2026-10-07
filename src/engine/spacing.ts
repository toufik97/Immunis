import type { SchedulePack } from "../loader";
import type { ImmunizationRecord } from "../types";
import { parseDate, formatDate, addDurationToDate, durationToDays } from "./duration";

export interface SpacingConstraint {
  id: string;
  pairs: [string, string][];
  bothLive: boolean;
  exemptions: [string, string][];
  minGapDays: number;
  sameDayAllowed: boolean;
  /** When both doses are due on the same day, this product is the one that waits. */
  move: string | null;
}


export function liveFlags(pack: SchedulePack): Record<string, boolean> {
  const productGroups: any[] = (pack as any).catalog?.product_groups ?? [];
  const isLive: Record<string, boolean> = {};
  for (const g of productGroups) isLive[g.id] = g?.clinical?.live === true;
  return isLive;
}

export function getSpacingConstraints(pack: SchedulePack): SpacingConstraint[] {
  const rules: any[] = (pack as any).spacing?.spacing_rules ?? [];
  if (!Array.isArray(rules)) return [];
  const out: SpacingConstraint[] = [];
  for (const r of rules) {
    const when = r?.applies_when ?? {};
    const pairs: [string, string][] = [];
    if (Array.isArray(when.pairs)) {
      for (const p of when.pairs) {
        if (p?.product_a && p?.product_b) pairs.push([p.product_a, p.product_b]);
      }
    }
    const exemptions: [string, string][] = [];
    if (Array.isArray(r?.exemptions)) {
      for (const ex of r.exemptions) {
        if (ex && ex.product_a && ex.product_b) exemptions.push([ex.product_a, ex.product_b]);
        else if (Array.isArray(ex) && ex.length === 2) exemptions.push([ex[0], ex[1]]);
      }
    }
    out.push({
      id: r.id ?? "unnamed",
      pairs,
      bothLive: when.both_live === true,
      exemptions,
      minGapDays: durationToDays(r.min_gap ?? { days: 28 }),
      sameDayAllowed: r.same_day_allowed !== false,
      move:
        typeof r.move_on_tie === "string"
          ? r.move_on_tie
          : typeof r.move === "string"
            ? r.move
            : null
    });
  }
  return out;
}

export function constrainedPair(
  constraints: SpacingConstraint[],
  a: string,
  b: string,
  isLive: Record<string, boolean>
): SpacingConstraint | null {
  for (const con of constraints) {
    const matches = con.bothLive
      ? isLive[a] === true && isLive[b] === true
      : con.pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    if (!matches) continue;
    const exempt = con.exemptions.some(
      ([x, y]) => (x === a && y === b) || (x === b && y === a)
    );
    if (exempt) continue;
    return con;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scheduling with spacing: replaces applySpacingRules + the old cascade.
// ---------------------------------------------------------------------------

export interface ScheduledVisit {
  date: Date;
  productGroupId: string;
  /** when the dose would be due if no spacing rule applied (never changes) */
  baseDate: Date;
  /** stable tie-break between visits that are otherwise equal */
  order: number;
}

const DAY_MS = 86400000;

/**
 * Place planned visits so that every dose respects (a) its own interval after the
 * previous dose of the same program and (b) the spacing rules against every other
 * dose, recorded or planned.
 *
 * Who waits when two doses conflict: the one that is due first keeps its date and the
 * other moves to at least min_gap after it. If both are due on the same day, the
 * rule's designated product (move_on_tie) waits, otherwise the one listed later.
 * Recorded doses never move. Dates only ever move later, so the loop terminates.
 *
 * chainLowerBound(v, all) returns the earliest date v may take given its own
 * program's previous dose (recorded or planned) and the age rules, using the
 * CURRENT dates of the other visits.
 */
export function scheduleWithSpacing<T extends ScheduledVisit>(
  visits: T[],
  history: ImmunizationRecord[],
  pack: SchedulePack,
  chainLowerBound: (visit: T, all: T[]) => Date
): string[] {
  const constraints = getSpacingConstraints(pack);
  const isLive = liveFlags(pack);
  const warnings: string[] = [];

  const relevant = (pid: string): boolean =>
    isLive[pid] === true ||
    constraints.some(c => c.pairs.some(([x, y]) => x === pid || y === pid));

  const recorded = history
    .filter(r => relevant(r.productGroupId))
    .map(r => ({ date: parseDate(r.administeredOn), productGroupId: r.productGroupId }));

  // Processing order: the dose due first settles first.
  const ordered = [...visits].sort(
    (a, b) => a.baseDate.getTime() - b.baseDate.getTime() || a.order - b.order
  );

  const conflicts = (a: Date, b: Date, con: SpacingConstraint): boolean => {
    const gap = Math.abs(Math.round((a.getTime() - b.getTime()) / DAY_MS));
    return con.sameDayAllowed ? gap > 0 && gap < con.minGapDays : gap < con.minGapDays;
  };

  // Does `other` keep its date and `v` wait?
  const otherWins = (v: T, other: T, con: SpacingConstraint): boolean => {
    const dv = v.baseDate.getTime();
    const dc = other.baseDate.getTime();
    if (dc !== dv) return dc < dv;
    if (con.move && v.productGroupId === con.move) return true;
    if (con.move && other.productGroupId === con.move) return false;
    return other.order < v.order;
  };

  let changed = true;
  let passes = 0;
  while (changed && passes < 200) {
    changed = false;
    passes++;

    for (const v of ordered) {
      const before = v.date;
      let date = chainLowerBound(v, visits);
      if (date.getTime() < before.getTime()) date = before; // never earlier
      let spacingCon: SpacingConstraint | null = null;

      // push past every dose that wins against v until nothing conflicts
      for (let guard = 0; guard < 100; guard++) {
        let pushTo: Date | null = null;
        let pushCon: SpacingConstraint | null = null;

        for (const r of recorded) {
          const con = constrainedPair(constraints, v.productGroupId, r.productGroupId, isLive);
          if (!con || !conflicts(date, r.date, con)) continue;
          const to = new Date(r.date.getTime());
          const target = addDurationToDate(to, { days: con.minGapDays });
          if (!pushTo || target > pushTo) { pushTo = target; pushCon = con; }
        }
        for (const o of visits) {
          if (o === v) continue;
          const con = constrainedPair(constraints, v.productGroupId, o.productGroupId, isLive);
          if (!con || !conflicts(date, o.date, con) || !otherWins(v, o, con)) continue;
          const target = addDurationToDate(o.date, { days: con.minGapDays });
          if (!pushTo || target > pushTo) { pushTo = target; pushCon = con; }
        }

        if (!pushTo || pushTo.getTime() <= date.getTime()) break;
        date = pushTo;
        spacingCon = pushCon;
      }

      if (date.getTime() > before.getTime()) {
        if (spacingCon) {
          const tag = spacingCon.bothLive ? "LIVE_SPACING_SHIFT" : "SPACING_SHIFT";
          warnings.push(
            `${tag}: ${v.productGroupId} moved from ${formatDate(before)} to ${formatDate(date)} (${spacingCon.id}: >= ${spacingCon.minGapDays} days apart).`
          );
        } else {
          warnings.push(
            `CASCADE_REPLAN: ${v.productGroupId} moved from ${formatDate(before)} to ${formatDate(date)} (interval from previous dose).`
          );
        }
        v.date = date;
        changed = true;
      }
    }
  }

  if (changed) {
    warnings.push(
      `SPACING_NOT_CONVERGED: spacing rules still moving visits after ${passes} passes; check the plan manually.`
    );
  }
  return warnings;
}

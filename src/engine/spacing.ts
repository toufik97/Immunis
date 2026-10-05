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
  move: string | null;
}

interface EventLike {
  date: Date;
  productGroupId: string;
  ref?: { date: Date };
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
      move: typeof r.move === "string" ? r.move : null
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

export function applySpacingRules(
  rawVisits: { date: Date; productGroupId: string }[],
  history: ImmunizationRecord[],
  pack: SchedulePack
): string[] {
  const constraints = getSpacingConstraints(pack);
  if (constraints.length === 0) return [];
  const isLive = liveFlags(pack);
  const warnings: string[] = [];

  const relevant = (pid: string): boolean =>
    isLive[pid] === true ||
    constraints.some(c => c.pairs.some(([x, y]) => x === pid || y === pid));

  const recorded: EventLike[] = history
    .filter(r => relevant(r.productGroupId))
    .map(r => ({ date: parseDate(r.administeredOn), productGroupId: r.productGroupId }));

  let changed = true;
  let guard = 0;
  while (changed && guard < 24) {
    changed = false;
    guard++;
    const planned: EventLike[] = rawVisits
      .filter(v => relevant(v.productGroupId))
      .map(v => ({ date: v.date, productGroupId: v.productGroupId, ref: v }));
    const events = [...recorded, ...planned];

    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const A = events[i];
        const B = events[j];
        const con = constrainedPair(constraints, A.productGroupId, B.productGroupId, isLive);
        if (!con) continue;

        const [early, late] =
          A.date.getTime() <= B.date.getTime() ? [A, B] : [B, A];
        const gapDays = Math.round(
          (late.date.getTime() - early.date.getTime()) / 86400000
        );
        const conflict = con.sameDayAllowed
          ? gapDays > 0 && gapDays < con.minGapDays
          : gapDays < con.minGapDays;
        if (!conflict) continue;

        let mover: EventLike | null = null;
        let other: EventLike | null = null;
        const designated = con.move;

        if (designated) {
          const dIsEarly = early.productGroupId === designated;
          const dIsLate = late.productGroupId === designated;
          if (dIsEarly || dIsLate) {
            const dEvent = dIsEarly ? early : late;
            const oEvent = dIsEarly ? late : early;
            if (dEvent.ref) { mover = dEvent; other = oEvent; }
            else if (oEvent.ref) { mover = oEvent; other = dEvent; }
          }
        }
        if (!mover) {
          if (late.ref) { mover = late; other = early; }
          else if (early.ref) { mover = early; other = late; }
        }
        if (!mover || !mover.ref || !other) continue;

        const newDate = addDurationToDate(other.date, { days: con.minGapDays });
        if (newDate.getTime() !== mover.ref.date.getTime()) {
          const tag = con.bothLive ? "LIVE_SPACING_SHIFT" : "SPACING_SHIFT";
          warnings.push(
            `${tag}: ${mover.productGroupId} moved from ${formatDate(mover.ref.date)} to ${formatDate(newDate)} (${con.id}: >= ${con.minGapDays} days apart).`
          );
          mover.ref.date = newDate;
          changed = true;
        }
      }
    }
  }
  if (changed) {
    warnings.push(
      "SPACING_NOT_CONVERGED: spacing rules still moving visits after 24 passes; check the plan manually."
    );
  }
  return warnings;
}
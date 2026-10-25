import type Database from "better-sqlite3";
import {
  countCellBookings,
  getBookingHorizon,
  listClosures,
  listSchedulingRules,
} from "../infra/repos/scheduling";
import type { SchedulingIssue, SchedulingRule, Slot } from "../domain/scheduling";

/** 0 = Sunday … 6 = Saturday, from a civil YYYY-MM-DD date (UTC math, no TZ drift). */
export function weekdayOf(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface BookingInput {
  dueDate: string;
  slot: Slot;
  expectedProducts: string[];
  /**
   * Horizon anchor: the engine-recommended date when the booking follows one,
   * else today (manual bookings). Drift is measured from here, never from the
   * booking day — booking the recommended date itself is always in horizon.
   */
  referenceDate: string;
  /** Row being rescheduled: excluded from cell counts so keeping its slot never blocks. */
  excludeAppointmentId?: string;
}

/**
 * Booking-time findings for an RDV date/slot, operational only (never clinical).
 * Resolution per product group: its own matrix cell wins; otherwise the global
 * cell; missing cells are unconstrained. Empty matrix + no closures/horizon =
 * no findings (today's behaviour). Callers decide block vs override.
 */
export function checkBooking(db: Database.Database, input: BookingInput): SchedulingIssue[] {
  const issues: SchedulingIssue[] = [];
  const weekday = weekdayOf(input.dueDate);

  const closure = listClosures(db, input.dueDate.slice(0, 4)).find((c) => c.date === input.dueDate);
  if (closure) {
    issues.push({ code: "closure_day", productGroupId: null, booked: null, cap: null, limit: closure.label });
  }

  const horizon = getBookingHorizon(db);
  if (horizon !== null) {
    const daysPast = Math.round(
      (Date.UTC(+input.dueDate.slice(0, 4), +input.dueDate.slice(5, 7) - 1, +input.dueDate.slice(8, 10)) -
        Date.UTC(+input.referenceDate.slice(0, 4), +input.referenceDate.slice(5, 7) - 1, +input.referenceDate.slice(8, 10))) /
        86_400_000
    );
    if (daysPast > horizon) {
      issues.push({ code: "beyond_horizon", productGroupId: null, booked: null, cap: null, limit: String(horizon) });
    }
  }

  const rules = listSchedulingRules(db);
  if (rules.length === 0) return issues;
  const byCell = new Map<string, SchedulingRule>();
  for (const r of rules) byCell.set(`${r.scope}|${r.weekday}|${r.slot}`, r);
  const scopes = new Set(rules.map((r) => r.scope));

  // One finding per applicable group so the nurse sees which vial/day is full.
  const groups = input.expectedProducts.length > 0 ? input.expectedProducts : [null];
  for (const g of groups) {
    const own = g !== null && scopes.has(g) ? byCell.get(`${g}|${weekday}|${input.slot}`) : undefined;
    const cell = own ?? byCell.get(`global|${weekday}|${input.slot}`);
    if (!cell) continue;
    if (cell.cap === 0) {
      issues.push({ code: "closed_day", productGroupId: g, booked: null, cap: 0, limit: null });
      continue;
    }
    // The count follows the cell's own scope: a global cell counts every
    // booking in it, a per-group cell only bookings expecting that group.
    const booked = countCellBookings(db, input.dueDate, input.slot, own ? g! : undefined, input.excludeAppointmentId);
    if (booked >= cell.cap) {
      issues.push({ code: "slot_full", productGroupId: g, booked, cap: cell.cap, limit: null });
    }
  }
  return issues;
}

/** Where to start looking, and how far (bounded so tight matrices can't loop forever). */
export interface SuggestInput {
  fromDate: string;
  expectedProducts: string[];
  preferSlot?: Slot;
  /** Horizon anchor, usually the engine date (= fromDate). Defaults to fromDate. */
  referenceDate?: string;
  /** Days ahead to scan when no horizon is set. Defaults to 120. */
  maxDays?: number;
}

export interface SuggestedSlot {
  date: string;
  slot: Slot;
}

/**
 * First bookable day/slot at or after the engine date: same day preferred
 * slot, then the other slot that day, then AM/PM day by day. Null when
 * nothing is clean inside the horizon (or maxDays). Pure candidates only —
 * the confirm gate still validates whatever the nurse finally picks.
 */
export function suggestBookingSlot(db: Database.Database, input: SuggestInput): SuggestedSlot | null {
  const prefer = input.preferSlot ?? "AM";
  const order: Slot[] = prefer === "AM" ? ["AM", "PM"] : ["PM", "AM"];
  const horizon = getBookingHorizon(db);
  const limit = Math.min(horizon ?? input.maxDays ?? 120, 365);
  const ref = input.referenceDate ?? input.fromDate;
  const [fy, fm, fd] = input.fromDate.split("-").map(Number);
  const base = Date.UTC(fy, fm - 1, fd);
  for (let d = 0; d <= limit; d++) {
    const at = new Date(base + d * 86_400_000);
    const date = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-${String(at.getUTCDate()).padStart(2, "0")}`;
    const slots = d === 0 ? order : (["AM", "PM"] as Slot[]);
    for (const slot of slots) {
      const issues = checkBooking(db, { dueDate: date, slot, expectedProducts: input.expectedProducts, referenceDate: ref });
      if (issues.length === 0) return { date, slot };
    }
  }
  return null;
}
/** Current load per slot cell, for warning copy ("slot full (25/25)"). */
export function cellLoad(
  db: Database.Database,
  date: string,
  slot: Slot,
  productGroupId?: string
): { booked: number; cap: number | null } {
  const rules = listSchedulingRules(db);
  const cells = byCell(rules);
  const own =
    productGroupId !== undefined && rules.some((r) => r.scope === productGroupId)
      ? cells.get(`${productGroupId}|${weekdayOf(date)}|${slot}`)
      : undefined;
  const cell = own ?? cells.get(`global|${weekdayOf(date)}|${slot}`);
  return { booked: countCellBookings(db, date, slot, own ? productGroupId : undefined), cap: cell?.cap ?? null };
}

function byCell(rules: SchedulingRule[]): Map<string, SchedulingRule> {
  const m = new Map<string, SchedulingRule>();
  for (const r of rules) m.set(`${r.scope}|${r.weekday}|${r.slot}`, r);
  return m;
}

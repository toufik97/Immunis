import type Database from "better-sqlite3";
import {
  ClosureDateSchema,
  SchedulingRuleSchema,
  type ClosureDate,
  type SchedulingRule,
  type Slot,
} from "../../domain/scheduling";

/** Whole scheduling matrix, global + per-product-group rows. Empty = unconstrained. */
export function listSchedulingRules(db: Database.Database): SchedulingRule[] {
  const rows = db.prepare("SELECT scope, weekday, slot, cap FROM scheduling_rules").all() as {
    scope: string;
    weekday: number;
    slot: string;
    cap: number;
  }[];
  return rows.map((r) => SchedulingRuleSchema.parse(r));
}

/** Replace the whole matrix in one transaction (the UI edits it as one form). */
export function replaceSchedulingRules(db: Database.Database, rules: SchedulingRule[]): SchedulingRule[] {
  const parsed = rules.map((r) => SchedulingRuleSchema.parse(r));
  const replace = db.transaction((rows: SchedulingRule[]) => {
    db.prepare("DELETE FROM scheduling_rules").run();
    const ins = db.prepare("INSERT INTO scheduling_rules (scope, weekday, slot, cap) VALUES (?, ?, ?, ?)");
    for (const r of rows) ins.run(r.scope, r.weekday, r.slot, r.cap);
  });
  replace(parsed);
  return listSchedulingRules(db);
}

const HORIZON_KEY = "booking_horizon_days";

/** Max days ahead a booking may be set, or null when unset (= no limit). */
export function getBookingHorizon(db: Database.Database): number | null {
  const row = db.prepare("SELECT value FROM centre_prefs WHERE key = ?").get(HORIZON_KEY) as
    | { value: string }
    | undefined;
  if (!row) return null;
  const n = Number(row.value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function setBookingHorizon(db: Database.Database, days: number | null): number | null {
  if (days === null) {
    db.prepare("DELETE FROM centre_prefs WHERE key = ?").run(HORIZON_KEY);
    return null;
  }
  if (!Number.isInteger(days) || days <= 0) throw new Error("horizon must be a positive whole number of days");
  db.prepare("INSERT INTO centre_prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?").run(
    HORIZON_KEY,
    String(days),
    String(days)
  );
  return days;
}

/** Closures for a year (or all when year is omitted), oldest first. */
export function listClosures(db: Database.Database, year?: string): ClosureDate[] {
  const rows = (
    year
      ? db.prepare("SELECT date, label, source FROM closure_dates WHERE date LIKE ? ORDER BY date").all(`${year}-%`)
      : db.prepare("SELECT date, label, source FROM closure_dates ORDER BY date").all()
  ) as { date: string; label: string; source: string }[];
  return rows.map((r) => ClosureDateSchema.parse(r));
}

export function addClosure(db: Database.Database, input: { date: string; label: string }): ClosureDate {
  const parsed = ClosureDateSchema.parse({ ...input, source: "manual" as const });
  db.prepare("INSERT INTO closure_dates (date, label, source) VALUES (?, ?, 'manual')").run(
    parsed.date,
    parsed.label
  );
  return parsed;
}

export function deleteClosure(db: Database.Database, date: string): boolean {
  return db.prepare("DELETE FROM closure_dates WHERE date = ?").run(date).changes > 0;
}

/**
 * Seed pulled holidays (source auto) without touching manual rows or manual
 * edits of the same date: a manual row always wins over a pulled one.
 */
export function upsertAutoClosures(db: Database.Database, holidays: { date: string; label: string }[]): number {
  const manual = new Set(
    (db.prepare("SELECT date FROM closure_dates WHERE source = 'manual'").all() as { date: string }[]).map(
      (r) => r.date
    )
  );
  const ins = db.prepare(
    "INSERT INTO closure_dates (date, label, source) VALUES (?, ?, 'auto') ON CONFLICT(date) DO UPDATE SET label = ? WHERE closure_dates.source = 'auto'"
  );
  let n = 0;
  for (const h of holidays) {
    if (manual.has(h.date)) continue;
    if (ins.run(h.date, h.label, h.label).changes > 0) n++;
  }
  return n;
}

/**
 * Pending bookings in a day/slot cell. Legacy NULL-slot rows count as AM
 * (mornings-first workflow predates slots). Kept/missed rows don't consume
 * capacity. When productGroupId is set, only bookings expecting it count
 * (e.g. BCG vial days); otherwise every booking in the cell counts.
 */
export function countCellBookings(
  db: Database.Database,
  date: string,
  slot: Slot,
  productGroupId?: string
): number {
  const rows = db
    .prepare(
      `SELECT expected_products FROM appointments
       WHERE due_date = ? AND kept IS NULL AND (slot = ? OR (slot IS NULL AND ? = 'AM'))`
    )
    .all(date, slot, slot) as { expected_products: string }[];
  if (!productGroupId) return rows.length;
  let n = 0;
  for (const r of rows) {
    try {
      const v: unknown = JSON.parse(r.expected_products);
      if (Array.isArray(v) && v.includes(productGroupId)) n++;
    } catch {
      /* unparseable row counts as zero */
    }
  }
  return n;
}

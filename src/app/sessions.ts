import type Database from "better-sqlite3";
import { listDue, listDueAll, listNoShows, listPendingInRange, countPendingBefore, dueStatsFor, lastVisitByChild } from "../infra/repos/appointments";
import { administeredFor } from "../infra/repos/encounters";
import type { Appointment } from "../domain/appointment";
import { localIdsForMany } from "../infra/repos/children";

export interface SessionRow extends Appointment {
  childName: string;
  localIds: { centreId: string; value: string }[];
  address: string | null;
}

/** Enrich appointments with Child name + Local id + address in 2 queries (no N+1). */
export function enrichAppointments(db: Database.Database, appointments: Appointment[]): SessionRow[] {
  if (appointments.length === 0) return [];
  const childIds = [...new Set(appointments.map((a) => a.childId))];
  const byId = new Map<string, { id: string; given_name: string; family_name: string; address: string | null }>();
  // Chunked: SQLite caps bound variables, so huge lists go in batches of 500.
  for (let i = 0; i < childIds.length; i += 500) {
    const slice = childIds.slice(i, i + 500);
    const placeholders = slice.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT id, given_name, family_name, address FROM children WHERE id IN (${placeholders})`)
      .all(...slice) as { id: string; given_name: string; family_name: string; address: string | null }[];
    for (const r of rows) byId.set(r.id, r);
  }
  const ids = localIdsForMany(db, childIds);
  return appointments.map((a) => {
    const c = byId.get(a.childId);
    return {
      ...a,
      childName: c ? `${c.given_name} ${c.family_name}` : a.childId,
      localIds: ids.get(a.childId) ?? [],
      address: c?.address ?? null,
    };
  });
}

export interface SessionSummary {
  date: string;
  /** Due exactly on date (legacy shape, kept for compat). */
  expected: PlannedSessionRow[];
  /** 1–6 days overdue: probable catch-ups. */
  probable: PlannedSessionRow[];
  /** 7–30 days overdue: possible catch-ups. */
  possible: PlannedSessionRow[];
  /** Legacy counters = due tier only. */
  counters: { children: number; dosesByProduct: Record<string, number> };
  tiers: {
    due: { children: number; dosesByProduct: Record<string, number> };
    probable: { children: number; dosesByProduct: Record<string, number> };
    possible: { children: number; dosesByProduct: Record<string, number> };
  };
  /** Pending strictly older than 30 days (links to No-shows, not auto-included). */
  backlog: { children: number; doses: number };
  /** What the day actually delivered (planned incl. resolved + visits seen + CENTRE doses). */
  results: {
    planned: number;
    plannedChildren: number;
    plannedDoses: Record<string, number>;
    kept: number;
    childrenSeen: number;
    dosesByProduct: Record<string, number>;
    /** Children seen that day with the CENTRE doses each received. */
    seen: SeenRow[];
    /** Due appointments never honoured (kept 0 or still NULL). */
    missed: SessionRow[];
  };
}

export interface SeenRow {
  childId: string;
  childName: string;
  localIds: { centreId: string; value: string }[];
  address: string | null;
  dosesGiven: string[];
  /** Had an appointment due on this session date (false = walk-in / catch-up from another date). */
  bookedToday: boolean;
  /** What was expected for this child on this date (empty for walk-ins). */
  expectedToday: string[];
}

export type Likelihood = "due" | "probable" | "possible";

export interface PlannedSessionRow extends SessionRow {
  likelihood: Likelihood;
  daysOverdue: number;
}

function doseCounts(rows: PlannedSessionRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of rows) {
    for (const p of a.expectedProducts) out[p] = (out[p] ?? 0) + 1;
  }
  return out;
}

/** Civil-date minus N days (UTC calendar arithmetic). */
function shiftDays(date: string, n: number): string {
  const t = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Session plan: due today + probable (<7d) + possible (7–30d) catch-ups, pending only. */
export function sessionFor(db: Database.Database, date: string): SessionSummary {
  const due = enrichAppointments(db, listDue(db, date)).map((r) => ({
    ...r,
    likelihood: "due" as const,
    daysOverdue: 0,
  }));
  // One range query for both catch-up tiers, then bucket by days overdue.
  const from = shiftDays(date, -30);
  const to = shiftDays(date, -1);
  const catchUps = from <= to ? enrichAppointments(db, listPendingInRange(db, from, to)) : [];
  const probable: PlannedSessionRow[] = [];
  const possible: PlannedSessionRow[] = [];
  for (const r of catchUps) {
    const overdue = daysBetween(r.dueDate, date);
    if (overdue >= 1 && overdue <= 6) probable.push({ ...r, likelihood: "probable", daysOverdue: overdue });
    else if (overdue >= 7 && overdue <= 30) possible.push({ ...r, likelihood: "possible", daysOverdue: overdue });
  }
  // Due first, then least-late catch-ups first.
  probable.sort((a, b) => a.daysOverdue - b.daysOverdue || a.childName.localeCompare(b.childName));
  possible.sort((a, b) => a.daysOverdue - b.daysOverdue || a.childName.localeCompare(b.childName));
  const tiers = {
    due: { children: due.length, dosesByProduct: doseCounts(due) },
    probable: { children: probable.length, dosesByProduct: doseCounts(probable) },
    possible: { children: possible.length, dosesByProduct: doseCounts(possible) },
  };
  const backlog = countPendingBefore(db, from);
  const dueStats = dueStatsFor(db, date);
  const given = administeredFor(db, date);
  const dueAll = listDueAll(db, date);
  // Booked-today lookup for the seen list (same query feeds missed, no extra I/O).
  const expectedByChild = new Map<string, string[]>();
  for (const a of dueAll) {
    const prev = expectedByChild.get(a.childId);
    if (prev) prev.push(...a.expectedProducts);
    else expectedByChild.set(a.childId, [...a.expectedProducts]);
  }
  const seen = enrichSeen(db, given.perChild, expectedByChild);
  const missed = enrichAppointments(db, dueAll.filter((a) => a.kept !== true));
  return {
    date,
    expected: due,
    probable,
    possible,
    counters: tiers.due,
    tiers,
    backlog,
    results: {
      planned: dueStats.planned,
      plannedChildren: dueStats.children,
      plannedDoses: dueStats.dosesByProduct,
      kept: dueStats.kept,
      childrenSeen: given.childrenSeen,
      dosesByProduct: given.dosesByProduct,
      seen,
      missed,
    },
  };
}

/** Enrich seen-children ids with registry name + local id + address (no N+1). */
function enrichSeen(
  db: Database.Database,
  entries: { childId: string; products: string[] }[],
  expectedByChild: Map<string, string[]> = new Map()
): SeenRow[] {
  if (entries.length === 0) return [];
  const childIds = [...new Set(entries.map((e) => e.childId))];
  const byId = new Map<string, { given_name: string; family_name: string; address: string | null }>();
  for (let i = 0; i < childIds.length; i += 500) {
    const slice = childIds.slice(i, i + 500);
    const placeholders = slice.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT id, given_name, family_name, address FROM children WHERE id IN (${placeholders})`)
      .all(...slice) as { id: string; given_name: string; family_name: string; address: string | null }[];
    for (const r of rows) byId.set(r.id, r);
  }
  const ids = localIdsForMany(db, childIds);
  return entries.map((e) => {
    const c = byId.get(e.childId);
    const expectedToday = expectedByChild.get(e.childId) ?? [];
    return {
      childId: e.childId,
      childName: c ? `${c.given_name} ${c.family_name}` : e.childId,
      localIds: ids.get(e.childId) ?? [],
      address: c?.address ?? null,
      dosesGiven: e.products,
      bookedToday: expectedByChild.has(e.childId),
      expectedToday,
    };
  });
}

/** Past-due appointments never honoured (FR-7.1). */
export function noShowsFor(db: Database.Database, asOf: string): NoShowRow[] {
  const appointments = listNoShows(db, asOf);
  const rows = enrichAppointments(db, appointments);
  const lastVisits = lastVisitByChild(
    db,
    rows.map((r) => r.childId)
  );
  return rows.map((r) => ({
    ...r,
    lastVisitDate: lastVisits.get(r.childId) ?? null,
    daysOverdue: daysBetween(r.dueDate, asOf),
  }));
}

export interface AgendaDay {
  date: string;
  children: number;
  doses: number;
}

/** Pending-appointment load per day in a window (session agenda, no trial-and-error). */
export function agendaFor(db: Database.Database, from: string, to: string): AgendaDay[] {
  const byDate = new Map<string, { children: Set<string>; doses: number }>();
  for (const a of listPendingInRange(db, from, to)) {
    let day = byDate.get(a.dueDate);
    if (!day) byDate.set(a.dueDate, (day = { children: new Set(), doses: 0 }));
    day.children.add(a.childId);
    day.doses += a.expectedProducts.length;
  }
  return [...byDate.entries()]
    .map(([date, d]) => ({ date, children: d.children.size, doses: d.doses }))
    .sort((x, y) => (x.date < y.date ? -1 : 1));
}

export interface NoShowRow extends SessionRow {
  lastVisitDate: string | null;
  /** Whole days asOf is past the due date (civil dates, UTC). */
  daysOverdue: number;
}

/** Whole days between two YYYY-MM-DD civil dates (b - a). */
function daysBetween(a: string, b: string): number {
  const ms = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10))) -
    Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  return Math.round(ms / 86_400_000);
}

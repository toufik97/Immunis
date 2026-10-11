import type Database from "better-sqlite3";
import { listDue, listNoShows, listPendingInRange, lastVisitByChild } from "../infra/repos/appointments";
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
  expected: SessionRow[];
  counters: { children: number; dosesByProduct: Record<string, number> };
}

/** Children expected on a session day + dose counters (FR-6.2), pending only. */
export function sessionFor(db: Database.Database, date: string): SessionSummary {
  const expected = enrichAppointments(db, listDue(db, date));
  const dosesByProduct: Record<string, number> = {};
  for (const a of expected) {
    for (const p of a.expectedProducts) dosesByProduct[p] = (dosesByProduct[p] ?? 0) + 1;
  }
  return { date, expected, counters: { children: expected.length, dosesByProduct } };
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

import type Database from "better-sqlite3";
import { listDue, listNoShows } from "../infra/repos/appointments";
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
  const placeholders = childIds.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT id, given_name, family_name, address FROM children WHERE id IN (${placeholders})`)
    .all(...childIds) as { id: string; given_name: string; family_name: string; address: string | null }[];
  const byId = new Map(rows.map((r) => [r.id, r]));
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
export function noShowsFor(db: Database.Database, asOf: string): SessionRow[] {
  return enrichAppointments(db, listNoShows(db, asOf));
}

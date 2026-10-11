import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { AppointmentSchema, type Appointment } from "../../domain/appointment";

export interface NewAppointment {
  childId: string;
  dueDate: string;
  expectedProducts?: string[];
}

interface AppointmentRow {
  id: string;
  child_id: string;
  due_date: string;
  expected_products: string;
  kept: number | null;
}

function toAppointment(row: AppointmentRow): Appointment {
  let expectedProducts: string[] = [];
  try {
    const v: unknown = JSON.parse(row.expected_products);
    if (Array.isArray(v)) expectedProducts = v.filter((x): x is string => typeof x === "string");
  } catch {
    expectedProducts = [];
  }
  return AppointmentSchema.parse({
    id: row.id,
    childId: row.child_id,
    dueDate: row.due_date,
    expectedProducts,
    kept: row.kept === null ? null : row.kept === 1,
  });
}

export function createAppointment(db: Database.Database, input: NewAppointment): Appointment {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO appointments (id, child_id, due_date, expected_products, kept) VALUES (?, ?, ?, ?, NULL)"
  ).run(id, input.childId, input.dueDate, JSON.stringify(input.expectedProducts ?? []));
  return toAppointment(db.prepare("SELECT * FROM appointments WHERE id = ?").get(id) as AppointmentRow);
}

/** Children expected on a session day (FR-6.2), pending only. */
export function listDue(db: Database.Database, date: string): Appointment[] {
  const rows = db
    .prepare("SELECT * FROM appointments WHERE due_date = ? AND kept IS NULL ORDER BY child_id")
    .all(date) as AppointmentRow[];
  return rows.map(toAppointment);
}

export function markAppointment(db: Database.Database, id: string, kept: boolean): boolean {
  const r = db.prepare("UPDATE appointments SET kept = ? WHERE id = ?").run(kept ? 1 : 0, id);
  return r.changes > 0;
}

/** Past-due appointments never honoured (FR-7.1). */
export function listNoShows(db: Database.Database, asOf: string): Appointment[] {
  const rows = db
    .prepare("SELECT * FROM appointments WHERE due_date < ? AND kept IS NULL ORDER BY due_date")
    .all(asOf) as AppointmentRow[];
  return rows.map(toAppointment);
}

/** Pending appointments in a window, oldest first (session agenda). */
export function listPendingInRange(db: Database.Database, from: string, to: string): Appointment[] {
  const rows = db
    .prepare("SELECT * FROM appointments WHERE due_date >= ? AND due_date <= ? AND kept IS NULL ORDER BY due_date")
    .all(from, to) as AppointmentRow[];
  return rows.map(toAppointment);
}

/** Latest recorded visit date per child (no-show context; null when never seen). */
export function lastVisitByChild(db: Database.Database, childIds: string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const id of childIds) out.set(id, null);
  for (let i = 0; i < childIds.length; i += 500) {
    const slice = childIds.slice(i, i + 500);
    const placeholders = slice.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT child_id, MAX(date) AS last_visit FROM encounters WHERE child_id IN (${placeholders}) GROUP BY child_id`)
      .all(...slice) as { child_id: string; last_visit: string | null }[];
    for (const r of rows) out.set(r.child_id, r.last_visit);
  }
  return out;
}

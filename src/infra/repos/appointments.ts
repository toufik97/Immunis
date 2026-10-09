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
  return AppointmentSchema.parse({
    id: row.id,
    childId: row.child_id,
    dueDate: row.due_date,
    expectedProducts: JSON.parse(row.expected_products) as string[],
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

export function markAppointment(db: Database.Database, id: string, kept: boolean): void {
  db.prepare("UPDATE appointments SET kept = ? WHERE id = ?").run(kept ? 1 : 0, id);
}

/** Past-due appointments never honoured (FR-7.1). */
export function listNoShows(db: Database.Database, asOf: string): Appointment[] {
  const rows = db
    .prepare("SELECT * FROM appointments WHERE due_date < ? AND kept IS NULL ORDER BY due_date")
    .all(asOf) as AppointmentRow[];
  return rows.map(toAppointment);
}

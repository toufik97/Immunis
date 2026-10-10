import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { EncounterSchema, type Encounter, type DoseRecord } from "../../domain/encounter";
import { isCentreCounted } from "../../domain/dose-origin";
import { consumeLot } from "./stock";
import { todayLocal, nowIso } from "../time";

export interface NewEncounter {
  childId: string;
  date: string;
  screening: "VACCINATE" | "DEFER" | "CONTRAINDICATED";
  screeningNote?: string;
  weightKg?: number;
  heightCm?: number;
  doses?: DoseRecord[];
  nextAppointmentDate?: string;
  /** Planner's products for the next visit, stored on the appointment (session prep). */
  expectedProducts?: string[];
}

interface DoseRow {
  product_group_id: string;
  administered_on: string;
  origin: string;
  lot_id: string | null;
  overridden: number;
  recorded_by: string;
}

export function toEngineDoses(rows: DoseRow[]): DoseRecord[] {  return rows.map((r) => ({
    productGroupId: r.product_group_id,
    administeredOn: r.administered_on,
    origin: r.origin as DoseRecord["origin"],
    lotId: r.lot_id ?? undefined,
    overridden: r.overridden === 1,
    recordedBy: r.recorded_by,
  }));
}

/** All recorded doses for a child (CENTRE + EXTERNAL + CAMPAIGN). */
export function listDosesByChild(db: Database.Database, childId: string): DoseRecord[] {
  const rows = db
    .prepare("SELECT * FROM doses WHERE child_id = ? ORDER BY administered_on")
    .all(childId) as DoseRow[];
  return toEngineDoses(rows);
}

export interface PersistOptions {
  /** Override centre wall-clock date (tests). Defaults to todayLocal(). */
  today?: string;
  /** Override audit/outbox timestamp (tests). Defaults to new Date().toISOString(). */
  nowIso?: string;
}

/** Civil-date credibility guards: visit/dose dates never in the future. */
export function validateEncounterDates(parsed: Encounter, today: string): void {
  if (parsed.date > today) {
    throw new Error(`encounter date ${parsed.date} is in the future`);
  }
  for (const dose of parsed.doses) {
    if (dose.administeredOn > parsed.date) {
      throw new Error(`dose date ${dose.administeredOn} is in the future relative to visit ${parsed.date}`);
    }
  }
  if (parsed.nextAppointmentDate && parsed.nextAppointmentDate < parsed.date) {
    throw new Error(`next appointment ${parsed.nextAppointmentDate} is in the past`);
  }
}

/**
 * Persist a validated encounter without opening a transaction.
 * Callers own the transaction so gate + audit rows can commit atomically.
 * CENTRE doses consume a usable lot (FR-4.3/4.4); EXTERNAL doses never touch stock.
 */
export function storeEncounter(
  db: Database.Database,
  parsed: Encounter,
  expectedProducts: string[] = [],
  opts?: { nowIso?: string }
): Encounter {
  const stamp = opts?.nowIso ?? nowIso();
  const encounterId = parsed.id;

  db.prepare(
    "INSERT INTO encounters (id, child_id, date, screening, screening_note, weight_kg, height_cm, next_appointment_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    encounterId,
    parsed.childId,
    parsed.date,
    parsed.screening,
    parsed.screeningNote ?? null,
    parsed.weightKg ?? null,
    parsed.heightCm ?? null,
    parsed.nextAppointmentDate ?? null
  );

  for (const dose of parsed.doses) {
    if (isCentreCounted(dose.origin)) {
      if (!dose.lotId) throw new Error("CENTRE dose requires a lot (FR-4.3)");
      consumeLot(db, dose.lotId, 1, parsed.date);
    }
    db.prepare(
      "INSERT INTO doses (id, encounter_id, child_id, product_group_id, administered_on, origin, lot_id, overridden, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      randomUUID(),
      encounterId,
      parsed.childId,
      dose.productGroupId,
      dose.administeredOn,
      dose.origin,
      dose.lotId ?? null,
      dose.overridden ? 1 : 0,
      dose.recordedBy
    );
  }

  // Presence is the visit itself: appointments due that day are kept; overdue
  // ones were missed, not kept — record that instead of rewriting history.
  db.prepare("UPDATE appointments SET kept = 1 WHERE child_id = ? AND due_date = ? AND kept IS NULL").run(
    parsed.childId,
    parsed.date
  );
  db.prepare("UPDATE appointments SET kept = 0 WHERE child_id = ? AND due_date < ? AND kept IS NULL").run(
    parsed.childId,
    parsed.date
  );

  if (parsed.nextAppointmentDate) {
    const expected = (expectedProducts ?? []).filter((p) => typeof p === "string" && p.length > 0);    db.prepare(
      "INSERT INTO appointments (id, child_id, due_date, expected_products, kept) VALUES (?, ?, ?, ?, NULL)"
    ).run(randomUUID(), parsed.childId, parsed.nextAppointmentDate, JSON.stringify(expected));
  }

  db.prepare("INSERT INTO outbox (id, kind, payload, created_at, synced_at) VALUES (?, ?, ?, ?, NULL)").run(
    randomUUID(),
    "encounter.recorded",
    JSON.stringify({ encounterId, childId: parsed.childId, date: parsed.date }),
    stamp
  );

  return parsed;
}

/**
 * Record one visit (FR-5.3): screening + growth + doses + next RDV, atomically.
 * Low-level persistence: no engine gate. Clinical writes must go through
 * `recordVisit` in src/app/ (gate + audit in the same transaction).
 * Future visit/dose dates are rejected (not credible); past history doses are fine.
 * Audit timestamps elsewhere are UTC ISO strings; civil dates stay calendar dates.
 */
export function recordEncounter(
  db: Database.Database,
  input: NewEncounter,
  opts?: PersistOptions
): Encounter {
  const encounterId = randomUUID();
  const parsed = EncounterSchema.parse({ ...input, id: encounterId, doses: input.doses ?? [] });
  validateEncounterDates(parsed, opts?.today ?? todayLocal());

  db.transaction(() => {
    storeEncounter(db, parsed, input.expectedProducts, { nowIso: opts?.nowIso });
  })();

  return parsed;
}

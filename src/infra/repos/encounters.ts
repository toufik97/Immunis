import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { EncounterSchema, type Encounter, type DoseRecord } from "../../domain/encounter";
import { checkLotUsable, consumeLot } from "./stock";

export interface NewEncounter {
  childId: string;
  date: string;
  screening: "VACCINATE" | "DEFER" | "CONTRAINDICATED";
  screeningNote?: string;
  weightKg?: number;
  heightCm?: number;
  doses?: DoseRecord[];
  nextAppointmentDate?: string;
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

/** Server-local calendar date (centre wall-clock) for credibility guards. */
export function todayLocal(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/**
 * Record one visit (FR-5.3): screening + growth + doses + next RDV, atomically.
 * CENTRE doses consume a usable lot (FR-4.3/4.4); EXTERNAL doses never touch stock.
 * Future visit/dose dates are rejected (not credible); past history doses are fine.
 * Audit timestamps elsewhere are UTC ISO strings; civil dates stay calendar dates.
 */
export function recordEncounter(db: Database.Database, input: NewEncounter): Encounter {
  const encounterId = randomUUID();
  const parsed = EncounterSchema.parse({ ...input, id: encounterId, doses: input.doses ?? [] });

  if (parsed.date > todayLocal()) {
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

  db.transaction(() => {
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
      if (dose.origin === "CENTRE") {
        if (!dose.lotId) throw new Error("CENTRE dose requires a lot (FR-4.3)");
        const problem = checkLotUsable(db, dose.lotId, parsed.date);
        if (problem !== "OK") throw new Error(`lot ${dose.lotId} is not usable: ${problem}`);
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

    if (parsed.nextAppointmentDate) {
      db.prepare(
        "INSERT INTO appointments (id, child_id, due_date, expected_products, kept) VALUES (?, ?, ?, ?, NULL)"
      ).run(randomUUID(), parsed.childId, parsed.nextAppointmentDate, "[]");
    }

    db.prepare("INSERT INTO outbox (id, kind, payload, created_at, synced_at) VALUES (?, ?, ?, ?, NULL)").run(
      randomUUID(),
      "encounter.recorded",
      JSON.stringify({ encounterId, childId: parsed.childId, date: parsed.date }),
      new Date().toISOString()
    );
  })();

  return parsed;
}

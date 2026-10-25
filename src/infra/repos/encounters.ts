import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { EncounterSchema, type Encounter, type DoseRecord } from "../../domain/encounter";
import { isStockCounted } from "../../domain/dose-origin";
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
  id: string;
  encounter_id: string;
  child_id: string;
  product_group_id: string;
  administered_on: string;
  origin: string;
  lot_id: string | null;
  overridden: number;
  recorded_by: string;
  transition: number;
  source: string | null;
  invalidated_at: string | null;
  invalidated_by: string | null;
  invalidated_reason: string | null;
}

export function toEngineDoses(rows: DoseRow[]): DoseRecord[] {  return rows.map((r) => ({
    productGroupId: r.product_group_id,
    administeredOn: r.administered_on,
    origin: r.origin as DoseRecord["origin"],
    lotId: r.lot_id ?? undefined,
    overridden: r.overridden === 1,
    recordedBy: r.recorded_by,
    transition: (r.transition ?? 0) === 1,
    source: r.source ?? undefined,
  }));
}

/** All recorded doses for a child (CENTRE + EXTERNAL + CAMPAIGN), voided visits excluded. */
export function listDosesByChild(db: Database.Database, childId: string): DoseRecord[] {
  const rows = db
    .prepare(
      `SELECT d.* FROM doses d JOIN encounters e ON e.id = d.encounter_id
       WHERE d.child_id = ? AND e.voided_at IS NULL ORDER BY d.administered_on`
    )
    .all(childId) as DoseRow[];
  return toEngineDoses(rows);
}

/** Dose rows with identity + correction state for the UI ledger and per-dose actions. */
export interface DoseDetail extends DoseRecord {
  id: string;
  encounterId: string;
  invalidatedAt: string | null;
  invalidatedBy: string | null;
  invalidatedReason: string | null;
}

export function listDoseDetailsByChild(db: Database.Database, childId: string): DoseDetail[] {
  const rows = db
    .prepare(
      `SELECT d.* FROM doses d JOIN encounters e ON e.id = d.encounter_id
       WHERE d.child_id = ? AND e.voided_at IS NULL ORDER BY d.administered_on`
    )
    .all(childId) as DoseRow[];
  return rows.map((r) => ({
    ...toEngineDoses([r])[0],
    id: r.id,
    encounterId: r.encounter_id,
    invalidatedAt: r.invalidated_at,
    invalidatedBy: r.invalidated_by,
    invalidatedReason: r.invalidated_reason,
  }));
}

/** Weight/height measures over time for one child (growth curves), voided visits excluded. */
export function listGrowthMeasures(db: Database.Database, childId: string): { date: string; weightKg: number | null; heightCm: number | null }[] {
  const rows = db
    .prepare("SELECT date, weight_kg, height_cm FROM encounters WHERE child_id = ? AND voided_at IS NULL AND (weight_kg IS NOT NULL OR height_cm IS NOT NULL) ORDER BY date")
    .all(childId) as { date: string; weight_kg: number | null; height_cm: number | null }[];
  return rows.map((r) => ({ date: r.date, weightKg: r.weight_kg, heightCm: r.height_cm }));
}

/** Encounter ledger for the correction ticket UI (includes voided visits, newest last). */
export interface EncounterDetail {
  id: string;
  childId: string;
  date: string;
  screening: string;
  doseIds: string[];
  voidRequestedBy: string | null;
  voidRequestedAt: string | null;
  voidRequestReason: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  reinstatedAt: string | null;
  reinstatedBy: string | null;
  reinstatedReason: string | null;
  /** Canonical product ids on the visit (for voided rows whose doses are excluded elsewhere). */
  products: string[];
}

export function listEncountersByChild(db: Database.Database, childId: string): EncounterDetail[] {
  const rows = db
    .prepare("SELECT * FROM encounters WHERE child_id = ? ORDER BY date")
    .all(childId) as Record<string, string | null>[];
  const doseRows = db
    .prepare("SELECT id, encounter_id, product_group_id FROM doses WHERE child_id = ?")
    .all(childId) as { id: string; encounter_id: string; product_group_id: string }[];
  const byEncounter = new Map<string, string[]>();
  const productsByEncounter = new Map<string, string[]>();
  for (const d of doseRows) {
    byEncounter.set(d.encounter_id, [...(byEncounter.get(d.encounter_id) ?? []), d.id]);
    productsByEncounter.set(d.encounter_id, [...(productsByEncounter.get(d.encounter_id) ?? []), d.product_group_id]);
  }
  return rows.map((r) => ({
    id: r.id as string,
    childId: r.child_id as string,
    date: r.date as string,
    screening: r.screening as string,
    doseIds: byEncounter.get(r.id as string) ?? [],
    voidRequestedBy: (r.void_requested_by as string) ?? null,
    voidRequestedAt: (r.void_requested_at as string) ?? null,
    voidRequestReason: (r.void_request_reason as string) ?? null,
    voidedAt: (r.voided_at as string) ?? null,
    voidedBy: (r.voided_by as string) ?? null,
    voidReason: (r.void_reason as string) ?? null,
    reinstatedAt: (r.reinstated_at as string) ?? null,
    reinstatedBy: (r.reinstated_by as string) ?? null,
    reinstatedReason: (r.reinstated_reason as string) ?? null,
    products: productsByEncounter.get(r.id as string) ?? [],
  }));
}

/** Single encounter or null. */
export function getEncounter(db: Database.Database, id: string): EncounterDetail | null {
  const r = db.prepare("SELECT * FROM encounters WHERE id = ?").get(id) as Record<string, string | null> | undefined;
  if (!r) return null;
  const doseRows = db.prepare("SELECT id FROM doses WHERE encounter_id = ?").all(id) as { id: string }[];
  const productRows = db.prepare("SELECT product_group_id FROM doses WHERE encounter_id = ?").all(id) as { product_group_id: string }[];
  return {
    id: r.id as string,
    childId: r.child_id as string,
    date: r.date as string,
    screening: r.screening as string,
    doseIds: doseRows.map((d) => d.id),
    voidRequestedBy: (r.void_requested_by as string) ?? null,
    voidRequestedAt: (r.void_requested_at as string) ?? null,
    voidRequestReason: (r.void_request_reason as string) ?? null,
    voidedAt: (r.voided_at as string) ?? null,
    voidedBy: (r.voided_by as string) ?? null,
    voidReason: (r.void_reason as string) ?? null,
    reinstatedAt: (r.reinstated_at as string) ?? null,
    reinstatedBy: (r.reinstated_by as string) ?? null,
    reinstatedReason: (r.reinstated_reason as string) ?? null,
    products: productRows.map((d) => d.product_group_id),
  };
}

/** Single dose row or null. */
export function getDose(db: Database.Database, id: string): DoseRow | null {
  return (db.prepare("SELECT * FROM doses WHERE id = ?").get(id) as DoseRow | undefined) ?? null;
}

/** What a session day actually delivered: visits seen + CENTRE doses given (stock rule §5.10). */
export function administeredFor(
  db: Database.Database,
  date: string
): { childrenSeen: number; dosesByProduct: Record<string, number>; perChild: { childId: string; products: string[] }[] } {
  const seen = db
    .prepare("SELECT COUNT(DISTINCT child_id) AS n FROM encounters WHERE date = ? AND voided_at IS NULL")
    .get(date) as { n: number };
  const rows = db
    .prepare(
      "SELECT d.product_group_id AS productGroupId, COUNT(*) AS n FROM doses d JOIN encounters e ON e.id = d.encounter_id WHERE e.date = ? AND e.voided_at IS NULL AND d.origin = 'CENTRE' GROUP BY d.product_group_id"
    )
    .all(date) as { productGroupId: string; n: number }[];
  const dosesByProduct: Record<string, number> = {};
  for (const r of rows) dosesByProduct[r.productGroupId] = r.n;
  const childRows = db
    .prepare(
      "SELECT e.child_id AS childId, d.product_group_id AS productGroupId FROM encounters e LEFT JOIN doses d ON d.encounter_id = e.id AND d.origin = 'CENTRE' WHERE e.date = ? AND e.voided_at IS NULL ORDER BY e.child_id"
    )
    .all(date) as { childId: string; productGroupId: string | null }[];
  const perChildMap = new Map<string, string[]>();
  for (const r of childRows) {
    if (!perChildMap.has(r.childId)) perChildMap.set(r.childId, []);
    if (r.productGroupId) perChildMap.get(r.childId)?.push(r.productGroupId);
  }
  return {
    childrenSeen: seen.n,
    dosesByProduct,
    perChild: [...perChildMap.entries()].map(([childId, products]) => ({ childId, products })),
  };
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

  // One visit = one encounter: a second save the same day (e.g. growth first,
  // doses after) merges into the existing non-voided row instead of creating
  // a duplicate date line. Voided visits are never merge targets.
  const existing = db
    .prepare("SELECT * FROM encounters WHERE child_id = ? AND date = ? AND voided_at IS NULL ORDER BY rowid LIMIT 1")
    .get(parsed.childId, parsed.date) as Record<string, string | number | null> | undefined;

  const encounterId = (existing?.id as string) ?? parsed.id;

  if (existing) {
    db.prepare(
      "UPDATE encounters SET screening = ?, screening_note = ?, weight_kg = ?, height_cm = ?, next_appointment_date = ? WHERE id = ?"
    ).run(
      parsed.screening,
      parsed.screeningNote ?? (existing.screening_note as string | null) ?? null,
      parsed.weightKg ?? (existing.weight_kg as number | null) ?? null,
      parsed.heightCm ?? (existing.height_cm as number | null) ?? null,
      parsed.nextAppointmentDate ?? (existing.next_appointment_date as string | null) ?? null,
      encounterId
    );
  } else {
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
  }

  for (const dose of parsed.doses) {
    if (isStockCounted(dose.origin, dose.transition)) {
      if (!dose.lotId) throw new Error("CENTRE dose requires a lot (FR-4.3)");
      consumeLot(db, dose.lotId, 1, parsed.date);
    }
    db.prepare(
      "INSERT INTO doses (id, encounter_id, child_id, product_group_id, administered_on, origin, lot_id, overridden, recorded_by, transition, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      randomUUID(),
      encounterId,
      parsed.childId,
      dose.productGroupId,
      dose.administeredOn,
      dose.origin,
      dose.lotId ?? null,
      dose.overridden ? 1 : 0,
      dose.recordedBy,
      dose.transition ? 1 : 0,
      dose.source ?? null
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
    const expected = (expectedProducts ?? []).filter((p) => typeof p === "string" && p.length > 0);
    // Merged second save may repeat the same RDV: never double-book it.
    const apptExists = db
      .prepare("SELECT 1 FROM appointments WHERE child_id = ? AND due_date = ? LIMIT 1")
      .get(parsed.childId, parsed.nextAppointmentDate) as { 1: number } | undefined;
    if (!apptExists) {
      db.prepare(
        "INSERT INTO appointments (id, child_id, due_date, expected_products, kept) VALUES (?, ?, ?, ?, NULL)"
      ).run(randomUUID(), parsed.childId, parsed.nextAppointmentDate, JSON.stringify(expected));
    }
  }

  db.prepare("INSERT INTO outbox (id, kind, payload, created_at, synced_at) VALUES (?, ?, ?, ?, NULL)").run(
    randomUUID(),
    "encounter.recorded",
    JSON.stringify({ encounterId, childId: parsed.childId, date: parsed.date }),
    stamp
  );

  return { ...parsed, id: encounterId };
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

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { OverrideEntrySchema, type OverrideEntry } from "../../domain/override";

export interface NewOverride {
  childId: string;
  encounterId?: string;
  author: string;
  what: string;
  reason: string;
  createdAt: string;
}

interface OverrideRow {
  id: string;
  child_id: string;
  encounter_id: string | null;
  author: string;
  what: string;
  reason: string;
  created_at: string;
}

function toEntry(row: OverrideRow): OverrideEntry {
  return OverrideEntrySchema.parse({
    id: row.id,
    childId: row.child_id,
    encounterId: row.encounter_id ?? undefined,
    author: row.author,
    what: row.what,
    reason: row.reason,
    createdAt: row.created_at,
  });
}

/**
 * Append an override (FR-8.2). Intentionally no update/delete:
 * the audit trail is append-only (FR-8.3).
 */
export function insertOverride(db: Database.Database, input: NewOverride): OverrideEntry {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO overrides (id, child_id, encounter_id, author, what, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, input.childId, input.encounterId ?? null, input.author, input.what, input.reason, input.createdAt);
  return toEntry(db.prepare("SELECT * FROM overrides WHERE id = ?").get(id) as OverrideRow);
}

export function listOverridesByChild(db: Database.Database, childId: string): OverrideEntry[] {
  const rows = db
    .prepare("SELECT * FROM overrides WHERE child_id = ? ORDER BY created_at")
    .all(childId) as OverrideRow[];
  return rows.map(toEntry);
}

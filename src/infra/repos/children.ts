import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { ChildSchema, type Child } from "../../domain/child";

export interface NewChild {
  familyName: string;
  givenName: string;
  birthDate: string;
  fatherName?: string;
  motherName?: string;
  address?: string;
}

interface ChildRow {
  id: string;
  family_name: string;
  given_name: string;
  birth_date: string;
  father_name: string | null;
  mother_name: string | null;
  address: string | null;
  national_id: string | null;
}

function toChild(row: ChildRow, localIds: { centreId: string; value: string }[]): Child {
  return ChildSchema.parse({
    id: row.id,
    familyName: row.family_name,
    givenName: row.given_name,
    birthDate: row.birth_date,
    fatherName: row.father_name ?? undefined,
    motherName: row.mother_name ?? undefined,
    address: row.address ?? undefined,
    localIds,
    nationalId: row.national_id ?? undefined,
  });
}

function localIdsFor(db: Database.Database, childId: string) {
  return db
    .prepare("SELECT centre_id, value FROM local_ids WHERE child_id = ?")
    .all(childId)
    .map((r: unknown) => {
      const row = r as { centre_id: string; value: string };
      return { centreId: row.centre_id, value: row.value };
    });
}

export function createChild(db: Database.Database, input: NewChild): Child {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO children (id, family_name, given_name, birth_date, father_name, mother_name, address) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, input.familyName, input.givenName, input.birthDate, input.fatherName ?? null, input.motherName ?? null, input.address ?? null);
  const row = db.prepare("SELECT * FROM children WHERE id = ?").get(id) as ChildRow;
  return toChild(row, []);
}

/** Case-insensitive name search (FR-1.1). */
export function findChildrenByName(db: Database.Database, query: string): Child[] {  const rows = db
    .prepare(
      "SELECT * FROM children WHERE family_name LIKE ? OR given_name LIKE ? ORDER BY family_name, given_name LIMIT 50"
    )
    .all(`%${query}%`, `%${query}%`) as ChildRow[];
  return rows.map((row) => toChild(row, localIdsFor(db, row.id)));
}

export function getChild(db: Database.Database, id: string): Child | null {
  const row = db.prepare("SELECT * FROM children WHERE id = ?").get(id) as ChildRow | undefined;
  if (!row) return null;
  return toChild(row, localIdsFor(db, id));
}

/**
 * Possible duplicates for the registration guard: same names
 * (case-insensitive) and same birthDate. Homonyms exist, so callers
 * warn rather than block — the nurse decides.
 */
export function findPossibleDuplicates(
  db: Database.Database,
  familyName: string,
  givenName: string,
  birthDate: string
): Child[] {
  const rows = db
    .prepare(
      "SELECT * FROM children WHERE LOWER(family_name) = LOWER(?) AND LOWER(given_name) = LOWER(?) AND birth_date = ?"
    )
    .all(familyName, givenName, birthDate) as ChildRow[];
  return rows.map((row) => toChild(row, localIdsFor(db, row.id)));
}

/**
 * Allocate the next "xx/yy" local id for a centre and first-visit year (FR-1.4).
 * Counter is annual per centre and resets every year.
 */
export function allocateLocalId(
  db: Database.Database,
  childId: string,
  centreId: string,
  year: string
): string {
  const existing = db
    .prepare("SELECT value FROM local_ids WHERE child_id = ? AND centre_id = ?")
    .get(childId, centreId) as { value: string } | undefined;
  if (existing) {
    throw new Error(
      `child already has local id ${existing.value} in centre ${centreId} (ids are fixed at first visit)`
    );
  }
  const value = db.transaction(() => {
    const cur = db
      .prepare("SELECT last_xx FROM id_counters WHERE centre_id = ? AND year = ?")
      .get(centreId, year) as { last_xx: number } | undefined;
    const xx = (cur?.last_xx ?? 0) + 1;
    db.prepare(
      "INSERT INTO id_counters (centre_id, year, last_xx) VALUES (?, ?, ?) ON CONFLICT (centre_id, year) DO UPDATE SET last_xx = ?"
    ).run(centreId, year, xx, xx);
    const v = `${xx}/${year}`;
    db.prepare("INSERT INTO local_ids (child_id, centre_id, value) VALUES (?, ?, ?)").run(
      childId,
      centreId,
      v
    );
    return v;
  })();
  return value;
}

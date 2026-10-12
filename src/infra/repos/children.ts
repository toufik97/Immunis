import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { ChildSchema, type Child } from "../../domain/child";

export interface NewChild {
  familyName: string;
  givenName: string;
  birthDate: string;
  sex?: "M" | "F";
  fatherName?: string;
  motherName?: string;
  address?: string;
}

interface ChildRow {
  id: string;
  family_name: string;
  given_name: string;
  birth_date: string;
  sex: string | null;
  father_name: string | null;
  mother_name: string | null;
  address: string | null;
  national_id: string | null;
}

export function toChild(row: ChildRow, localIds: { centreId: string; value: string }[]): Child {
  return ChildSchema.parse({
    id: row.id,
    familyName: row.family_name,
    givenName: row.given_name,
    birthDate: row.birth_date,
    sex: row.sex ?? null,
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

/** Single-query local ids for many children (session lists avoid N+1). */
export function localIdsForMany(
  db: Database.Database,
  childIds: string[]
): Map<string, { centreId: string; value: string }[]> {
  const out = new Map<string, { centreId: string; value: string }[]>();
  for (const id of childIds) out.set(id, []);
  // Chunked: SQLite caps bound variables, so huge lists go in batches of 500.
  for (let i = 0; i < childIds.length; i += 500) {
    const slice = childIds.slice(i, i + 500);
    const placeholders = slice.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT child_id, centre_id, value FROM local_ids WHERE child_id IN (${placeholders})`)
      .all(...slice) as { child_id: string; centre_id: string; value: string }[];
    for (const r of rows) {
      out.get(r.child_id)?.push({ centreId: r.centre_id, value: r.value });
    }
  }
  return out;
}

export function createChild(db: Database.Database, input: NewChild): Child {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO children (id, family_name, given_name, birth_date, sex, father_name, mother_name, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, input.familyName, input.givenName, input.birthDate, input.sex ?? null, input.fatherName ?? null, input.motherName ?? null, input.address ?? null);
  const row = db.prepare("SELECT * FROM children WHERE id = ?").get(id) as ChildRow;
  return toChild(row, []);
}

/** Case-insensitive name search (FR-1.1). */
export function findChildrenByName(db: Database.Database, query: string): Child[] {  const q = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = db
    .prepare(
      "SELECT * FROM children WHERE family_name LIKE ? ESCAPE '\\' OR given_name LIKE ? ESCAPE '\\' ORDER BY family_name, given_name LIMIT 50"
    )
    .all(`%${q}%`, `%${q}%`) as ChildRow[];
  const ids = new Map(localIdsForMany(db, rows.map((r) => r.id)));
  return rows.map((row) => toChild(row, ids.get(row.id) ?? []));
}

export function getChild(db: Database.Database, id: string): Child | null {
  const row = db.prepare("SELECT * FROM children WHERE id = ?").get(id) as ChildRow | undefined;
  if (!row) return null;
  return toChild(row, localIdsFor(db, id));
}

/** All registered children with local ids (registry browser; centres are small). */
export function listChildren(db: Database.Database): Child[] {
  const rows = db
    .prepare("SELECT * FROM children ORDER BY family_name, given_name LIMIT 500")
    .all() as ChildRow[];
  const ids = new Map(localIdsForMany(db, rows.map((r) => r.id)));
  return rows.map((row) => toChild(row, ids.get(row.id) ?? []));
}

/**
 * Possible duplicates for the registration guard: same names
 * (case-insensitive) and same birthDate. Homonyms exist, so callers
 * warn rather than block — the nurse decides. Same-sex matching only:
 * boy/girl twins sharing names and birth date are not duplicates.
 * Pre-field rows with unknown sex still match (conservative).
 */
export function findPossibleDuplicates(
  db: Database.Database,
  familyName: string,
  givenName: string,
  birthDate: string,
  sex?: "M" | "F" | null
): Child[] {
  const rows = db
    .prepare(
      "SELECT * FROM children WHERE LOWER(family_name) = LOWER(?) AND LOWER(given_name) = LOWER(?) AND birth_date = ?"
    )
    .all(familyName, givenName, birthDate) as ChildRow[];
  const ids = new Map(localIdsForMany(db, rows.map((r) => r.id)));
  return rows
    .filter((r) => !sex || !r.sex || r.sex === sex)
    .map((row) => toChild(row, ids.get(row.id) ?? []));
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

import type Database from "better-sqlite3";

/** Additive migrations for existing per-centre DB files (fresh files already match schema.sql). */
const MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "children", column: "father_name", ddl: "TEXT" },
  { table: "children", column: "mother_name", ddl: "TEXT" },
  { table: "children", column: "address", ddl: "TEXT" },
];

export function runMigrations(db: Database.Database): void {
  for (const m of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === m.column)) {
      db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.ddl}`);
    }
  }
}

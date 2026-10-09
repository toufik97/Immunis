import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

let db: Database.Database | null = null;

import { runMigrations } from "./migrate";

/** Open (or create) the per-centre SQLite file and apply schema.sql. */
export function openDb(filePath: string): Database.Database {
  if (db) return db;
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(
    path.resolve(process.cwd(), "src", "infra", "db", "schema.sql"),
    "utf8"
  );
  db.exec(schema);
  runMigrations(db);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error("DB not opened: call openDb() first");
  return db;
}

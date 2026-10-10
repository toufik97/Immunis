import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { runMigrations } from "./migrate";

const open = new Map<string, Database.Database>();

/** Open (or reuse) the per-centre SQLite file and apply schema.sql. */
export function openDb(filePath: string): Database.Database {
  const key = path.resolve(filePath);
  const hit = open.get(key);
  if (hit) return hit;
  const dir = path.dirname(key);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(key);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql"),
    "utf8"
  );
  db.exec(schema);
  runMigrations(db);
  open.set(key, db);
  return db;
}

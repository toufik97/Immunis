import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/** Fresh isolated in-memory DB with schema applied (tests only). */
export function openTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(
    path.resolve(process.cwd(), "src", "infra", "db", "schema.sql"),
    "utf8"
  );
  db.exec(schema);
  return db;
}

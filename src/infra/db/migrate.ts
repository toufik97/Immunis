import type Database from "better-sqlite3";

/** Additive migrations for existing per-centre DB files (fresh files already match schema.sql). */
const MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "children", column: "father_name", ddl: "TEXT" },
  { table: "children", column: "mother_name", ddl: "TEXT" },
  { table: "children", column: "address", ddl: "TEXT" },
  { table: "children", column: "sex", ddl: "TEXT" },
  { table: "doses", column: "transition", ddl: "INTEGER NOT NULL DEFAULT 0 CHECK (transition IN (0, 1))" },
  { table: "doses", column: "source", ddl: "TEXT" },
  { table: "users", column: "failed_attempts", ddl: "INTEGER NOT NULL DEFAULT 0" },
  { table: "users", column: "locked_until", ddl: "TEXT" },
];

const NEW_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('nurse', 'admin', 'reader')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  created_at TEXT NOT NULL,
  last_login_at TEXT
)`,
  `CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS transition_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  granted_by TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  user_id TEXT REFERENCES users(id),
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  child_id TEXT REFERENCES children(id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_transition_grants_user ON transition_grants(user_id)`,
];

export function runMigrations(db: Database.Database): void {
  for (const ddl of NEW_TABLES) db.exec(ddl);
  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name)
  );
  for (const m of MIGRATIONS) {
    if (!tables.has(m.table)) continue;
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === m.column)) {
      db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.ddl}`);
    }
  }
}

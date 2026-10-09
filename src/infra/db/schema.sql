-- Immunis v1 local schema (SQLite, one file per centre).
-- Audit table is append-only: no UPDATE/DELETE from the app layer.

CREATE TABLE IF NOT EXISTS children (
  id TEXT PRIMARY KEY,
  family_name TEXT NOT NULL,
  given_name TEXT NOT NULL,
  birth_date TEXT NOT NULL,          -- YYYY-MM-DD, identity confirmation key
  parent_names TEXT,
  national_id TEXT                   -- reserved, NULL in v1
);
CREATE TABLE IF NOT EXISTS local_ids (
  child_id TEXT NOT NULL REFERENCES children(id),
  centre_id TEXT NOT NULL,
  value TEXT NOT NULL,               -- "xx/yy"
  PRIMARY KEY (child_id, centre_id)
);

CREATE TABLE IF NOT EXISTS lots (
  id TEXT PRIMARY KEY,
  product_group_id TEXT NOT NULL,
  lot_number TEXT NOT NULL,
  expiry_date TEXT NOT NULL,         -- YYYY-MM-DD
  cold_chain_ok INTEGER NOT NULL DEFAULT 1 CHECK (cold_chain_ok IN (0, 1)),
  qty_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0)
);

CREATE TABLE IF NOT EXISTS encounters (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id),
  date TEXT NOT NULL,                -- YYYY-MM-DD
  screening TEXT NOT NULL CHECK (screening IN ('VACCINATE', 'DEFER', 'CONTRAINDICATED')),
  screening_note TEXT,
  weight_kg REAL,
  height_cm REAL,
  next_appointment_date TEXT
);

CREATE TABLE IF NOT EXISTS doses (
  id TEXT PRIMARY KEY,
  encounter_id TEXT NOT NULL REFERENCES encounters(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  product_group_id TEXT NOT NULL,
  administered_on TEXT NOT NULL,     -- YYYY-MM-DD
  origin TEXT NOT NULL CHECK (origin IN ('CENTRE', 'EXTERNAL', 'CAMPAIGN')),
  lot_id TEXT REFERENCES lots(id),
  overridden INTEGER NOT NULL DEFAULT 0 CHECK (overridden IN (0, 1)),
  recorded_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id),
  due_date TEXT NOT NULL,
  expected_products TEXT NOT NULL DEFAULT '[]',
  kept INTEGER CHECK (kept IN (0, 1)) -- NULL = pending, 1 = kept, 0 = missed
);

CREATE TABLE IF NOT EXISTS overrides (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id),
  encounter_id TEXT,
  author TEXT NOT NULL,
  what TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_doses_child ON doses(child_id);
CREATE INDEX IF NOT EXISTS idx_appointments_due ON appointments(due_date);

-- Audit is append-only (FR-8.3): enforced below the repo layer too.
CREATE TRIGGER IF NOT EXISTS overrides_no_update
BEFORE UPDATE ON overrides
BEGIN
  SELECT RAISE(ABORT, 'overrides is append-only');
END;

CREATE TRIGGER IF NOT EXISTS overrides_no_delete
BEFORE DELETE ON overrides
BEGIN
  SELECT RAISE(ABORT, 'overrides is append-only');
END;

-- Annual per-centre registry counter for "xx/yy" local ids (FR-1.4).
CREATE TABLE IF NOT EXISTS id_counters (
  centre_id TEXT NOT NULL,
  year TEXT NOT NULL,
  last_xx INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (centre_id, year)
);

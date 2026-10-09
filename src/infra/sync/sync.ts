import type Database from "better-sqlite3";

const TABLES = [
  "children",
  "local_ids",
  "lots",
  "encounters",
  "doses",
  "appointments",
  "overrides",
  "id_counters",
  "outbox",
] as const;

export interface CentreDump {
  version: 1;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

/** Full centre export as JSON (backup + future central aggregation). */
export function exportCentre(db: Database.Database): CentreDump {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of TABLES) {
    tables[t] = db.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
  }
  return { version: 1, exportedAt: new Date().toISOString(), tables };
}

export interface ImportStats {
  children: number;
  doses: number;
}

/**
 * Import a centre dump. Idempotent (INSERT OR IGNORE) so the same file
 * can be applied twice; id counters keep their maximum.
 */
export function importCentre(db: Database.Database, dump: CentreDump): ImportStats {
  if (dump.version !== 1) throw new Error(`unsupported dump version ${dump.version}`);
  const stats = db.transaction(() => {
    const put = (table: string, rows: Record<string, unknown>[]) => {
      for (const row of rows) {
        const cols = Object.keys(row);
        const placeholders = cols.map(() => "?").join(", ");
        db.prepare(
          `INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`
        ).run(...cols.map((c) => row[c] as unknown));
      }
    };
    put("children", dump.tables["children"] ?? []);
    put("lots", dump.tables["lots"] ?? []);
    put("encounters", dump.tables["encounters"] ?? []);
    put("appointments", dump.tables["appointments"] ?? []);
    put("local_ids", dump.tables["local_ids"] ?? []);
    put("doses", dump.tables["doses"] ?? []);
    put("overrides", dump.tables["overrides"] ?? []);
    put("outbox", dump.tables["outbox"] ?? []);
    for (const row of dump.tables["id_counters"] ?? []) {
      const cur = db
        .prepare("SELECT last_xx FROM id_counters WHERE centre_id = ? AND year = ?")
        .get(row["centre_id"] as string, row["year"] as string) as
        | { last_xx: number }
        | undefined;
      const merged = Math.max(cur?.last_xx ?? 0, row["last_xx"] as number);
      db.prepare(
        "INSERT INTO id_counters (centre_id, year, last_xx) VALUES (?, ?, ?) ON CONFLICT (centre_id, year) DO UPDATE SET last_xx = ?"
      ).run(row["centre_id"] as string, row["year"] as string, merged, merged);
    }
    return {
      children: (db.prepare("SELECT COUNT(*) AS n FROM children").get() as { n: number }).n,
      doses: (db.prepare("SELECT COUNT(*) AS n FROM doses").get() as { n: number }).n,
    };
  })();
  return stats;
}

/** Outbox entries not yet synced to central. */
export function listPendingOutbox(db: Database.Database): { id: string; kind: string }[] {
  return db.prepare("SELECT id, kind FROM outbox WHERE synced_at IS NULL ORDER BY created_at").all() as {
    id: string;
    kind: string;
  }[];
}

export function ackOutbox(db: Database.Database, id: string, syncedAt: string): void {
  db.prepare("UPDATE outbox SET synced_at = ? WHERE id = ?").run(syncedAt, id);
}

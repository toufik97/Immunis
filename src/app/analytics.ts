import type Database from "better-sqlite3";

/**
 * Centre analytics read CENTRE doses only (spec §5.10 / FR-9.1).
 * EXTERNAL doses are clinically credited but never counted here.
 */
export function countCentreDosesByProduct(db: Database.Database): Record<string, number> {
  const rows = db
    .prepare(
      "SELECT product_group_id, COUNT(*) AS n FROM doses WHERE origin = 'CENTRE' GROUP BY product_group_id"
    )
    .all() as { product_group_id: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.product_group_id, r.n]));
}

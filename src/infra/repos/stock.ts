import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { LotSchema, type Lot } from "../../domain/stock";

export interface NewLot {
  productGroupId: string;
  lotNumber: string;
  expiryDate: string;
  coldChainOk: boolean;
  qtyOnHand: number;
}

interface LotRow {
  id: string;
  product_group_id: string;
  lot_number: string;
  expiry_date: string;
  cold_chain_ok: number;
  qty_on_hand: number;
}

function toLot(row: LotRow): Lot {
  return LotSchema.parse({
    id: row.id,
    productGroupId: row.product_group_id,
    lotNumber: row.lot_number,
    expiryDate: row.expiry_date,
    coldChainOk: row.cold_chain_ok === 1,
    qtyOnHand: row.qty_on_hand,
  });
}

export function addLot(db: Database.Database, input: NewLot): Lot {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO lots (id, product_group_id, lot_number, expiry_date, cold_chain_ok, qty_on_hand) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    input.productGroupId,
    input.lotNumber,
    input.expiryDate,
    input.coldChainOk ? 1 : 0,
    input.qtyOnHand
  );
  return toLot(db.prepare("SELECT * FROM lots WHERE id = ?").get(id) as LotRow);
}

export function getLot(db: Database.Database, id: string): Lot | null {
  const row = db.prepare("SELECT * FROM lots WHERE id = ?").get(id) as LotRow | undefined;
  return row ? toLot(row) : null;
}

export function listLots(db: Database.Database, productGroupId?: string): Lot[] {
  const rows = (
    productGroupId
      ? db.prepare("SELECT * FROM lots WHERE product_group_id = ? ORDER BY expiry_date").all(productGroupId)
      : db.prepare("SELECT * FROM lots ORDER BY product_group_id, expiry_date").all()
  ) as LotRow[];
  return rows.map(toLot);
}

export type LotProblem = "OK" | "NOT_FOUND" | "EXPIRED" | "COLD_CHAIN_BROKEN" | "OUT_OF_STOCK";

function localToday(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/** Pre-administration check (FR-4.4): expiry, integrity, cold chain, lot. */
export function checkLotUsable(
  db: Database.Database,
  lotId: string,
  onDate: string
): LotProblem {
  const lot = getLot(db, lotId);
  if (!lot) return "NOT_FOUND";
  if (lot.expiryDate < onDate) return "EXPIRED";
  if (!lot.coldChainOk) return "COLD_CHAIN_BROKEN";
  if (lot.qtyOnHand <= 0) return "OUT_OF_STOCK";
  return "OK";
}

/** Decrement stock; throws when the lot is unusable. */
export function consumeLot(
  db: Database.Database,
  lotId: string,
  qty = 1,
  onDate = localToday()
): void {
  const problem = checkLotUsable(db, lotId, onDate);
  if (problem !== "OK") throw new Error(`lot ${lotId} is not usable: ${problem}`);
  const lot = getLot(db, lotId);
  if (lot && lot.qtyOnHand < qty) {
    throw new Error(`lot ${lotId} has only ${lot.qtyOnHand} doses, cannot consume ${qty}`);
  }
  db.prepare("UPDATE lots SET qty_on_hand = qty_on_hand - ? WHERE id = ?").run(qty, lotId);
}

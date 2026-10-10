import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { addLot, getLot, consumeLot, checkLotUsable, usableLotsFor } from "../../src/infra/repos/stock";

describe("stock lots", () => {
  it("adds a lot and consumes from it", () => {
    const db = openTestDb();
    const lot = addLot(db, {
      productGroupId: "PENTA",
      lotNumber: "L123",
      expiryDate: "2027-01-01",
      coldChainOk: true,
      qtyOnHand: 10,
    });
    consumeLot(db, lot.id, 2);
    expect(getLot(db, lot.id)?.qtyOnHand).toBe(8);
    db.close();
  });

  it("refuses to over-consume", () => {
    const db = openTestDb();
    const lot = addLot(db, {
      productGroupId: "PENTA",
      lotNumber: "L123",
      expiryDate: "2027-01-01",
      coldChainOk: true,
      qtyOnHand: 1,
    });
    expect(() => consumeLot(db, lot.id, 2)).toThrow(/not usable/);
    expect(getLot(db, lot.id)?.qtyOnHand).toBe(1);
    db.close();
  });

  it("flags expired or cold-chain-broken lots as unusable", () => {
    const db = openTestDb();
    const expired = addLot(db, {
      productGroupId: "PENTA",
      lotNumber: "OLD",
      expiryDate: "2020-01-01",
      coldChainOk: true,
      qtyOnHand: 5,
    });
    const warm = addLot(db, {
      productGroupId: "PENTA",
      lotNumber: "WARM",
      expiryDate: "2027-01-01",
      coldChainOk: false,
      qtyOnHand: 5,
    });
    expect(checkLotUsable(db, expired.id, "2026-10-09")).toBe("EXPIRED");
    expect(checkLotUsable(db, warm.id, "2026-10-09")).toBe("COLD_CHAIN_BROKEN");
    expect(() => consumeLot(db, expired.id, 1, "2026-10-09")).toThrow();
    db.close();
  });

  it("lists usable lots earliest-expiry-first, hiding expired/broken/empty", () => {
    const db = openTestDb();
    const mk = (lotNumber: string, expiryDate: string, coldChainOk: boolean, qtyOnHand: number) =>
      addLot(db, { productGroupId: "PENTA", lotNumber, expiryDate, coldChainOk, qtyOnHand });
    const late = mk("LATE", "2027-06-01", true, 5);
    mk("OLD", "2020-01-01", true, 5);
    mk("WARM", "2027-01-01", false, 5);
    mk("EMPTY", "2027-01-01", true, 0);
    const early = mk("EARLY", "2027-01-01", true, 5);
    const usable = usableLotsFor(db, "PENTA", "2026-10-09");
    expect(usable.map((l) => l.id)).toEqual([early.id, late.id]);
    db.close();
  });
});

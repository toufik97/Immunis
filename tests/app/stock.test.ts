import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { addLot, getLot, consumeLot, checkLotUsable } from "../../src/infra/repos/stock";

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
    expect(() => consumeLot(db, lot.id, 2)).toThrow();
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
});

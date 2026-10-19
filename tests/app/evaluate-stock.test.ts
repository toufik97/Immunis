import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { loadSchedulePack } from "../../src/infra/packs/loader";
import { buildApp } from "../../src/api/app";
import { registerChild } from "../../src/app/register-child";
import { addLot } from "../../src/infra/repos/stock";
import { todayLocal } from "../../src/infra/time";

const pack = loadSchedulePack("MA");

function child(db: never) {
  const r = registerChild(db as never, {
    familyName: "F",
    givenName: "G",
    birthDate: "2025-01-01",
    sex: "F",
    centreId: "CS01",
    firstVisitYear: "2026",
  });
  if (r.status !== "created") throw new Error("register failed");
  return r.child;
}

describe("evaluate connects centre stock for child evaluations", () => {
  it("drops the stock assumption when usable lots exist", async () => {
    const db = openTestDb();
    const c = child(db as never);
    addLot(db, { productGroupId: "BCG", lotNumber: "L1", expiryDate: "2027-01-01", coldChainOk: true, qtyOnHand: 10 });
    const app = buildApp(db, pack);
    const res = await app.inject({
      method: "POST",
      url: "/api/evaluate",
      payload: { childId: c.id, evaluationDate: todayLocal(), projection: "next" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { assumptions?: string[] };
    expect((body.assumptions ?? []).some((a) => a.includes("stock not connected"))).toBe(false);
    db.close();
  });

  it("keeps the stock assumption when no usable lot exists", async () => {
    const db = openTestDb();
    const c = child(db as never);
    const app = buildApp(db, pack);
    const res = await app.inject({
      method: "POST",
      url: "/api/evaluate",
      payload: { childId: c.id, evaluationDate: todayLocal(), projection: "next" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { assumptions?: string[] };
    expect((body.assumptions ?? []).some((a) => a.includes("stock not connected"))).toBe(true);
    db.close();
  });

  it("leaves raw-history evaluations warn-when-blind", async () => {
    const db = openTestDb();
    addLot(db, { productGroupId: "BCG", lotNumber: "L1", expiryDate: "2027-01-01", coldChainOk: true, qtyOnHand: 10 });
    const app = buildApp(db, pack);
    const res = await app.inject({
      method: "POST",
      url: "/api/evaluate",
      payload: { birthDate: "2025-01-01", history: [], evaluationDate: todayLocal(), projection: "next" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { assumptions?: string[] };
    expect((body.assumptions ?? []).some((a) => a.includes("stock not connected"))).toBe(true);
    db.close();
  });
});

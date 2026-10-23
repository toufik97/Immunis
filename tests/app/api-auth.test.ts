import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { loadSchedulePack } from "../../src/infra/packs/loader";
import { buildApp } from "../../src/api/app";

const pack = loadSchedulePack("MA");

describe("api session auth (replaces the old shared token)", () => {
  it("rejects /api without login, allows health + session holders", async () => {
    const db = openTestDb();
    const app = buildApp(db, pack);

    expect((await app.inject({ method: "GET", url: "/api/pack" })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/api/pack", headers: { "x-api-token": "wrong" } })).statusCode
    ).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    db.close();
  });
});

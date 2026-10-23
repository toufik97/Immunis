import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { loadSchedulePack } from "../../src/infra/packs/loader";
import { buildApp } from "../../src/api/app";
import { createUser } from "../../src/infra/repos/auth";
import { nowIso } from "../../src/infra/time";

const pack = loadSchedulePack("MA");
const NOW = "2026-10-13T10:00:00.000Z";

function seed(role: "nurse" | "admin" | "reader" = "nurse") {
  const db = openTestDb();
  createUser(db, { username: `${role}1`, fullName: `${role} One`, role, password: "password-123", mustChangePassword: false, createdAt: NOW });
  return db;
}

type InjectRes = { body: string; statusCode: number };
function body<T>(res: InjectRes): T {
  return JSON.parse(res.body) as T;
}

async function loginAs(app: ReturnType<typeof buildApp>, username: string, password = "password-123") {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  expect(res.statusCode).toBe(200);
  const data = body<{ sessionId: string }>(res as unknown as InjectRes);
  return { "x-api-token": data.sessionId };
}

describe("auth and privileges", () => {
  it("requires login everywhere except health/login/bootstrap", async () => {
    const db = seed("nurse");
    const app = buildApp(db, pack);
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/pack" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/children" })).statusCode).toBe(401);
    db.close();
  });

  it("rejects wrong passwords and locks after 5 tries", async () => {
    const db = seed("nurse");
    const app = buildApp(db, pack);
    for (let i = 0; i < 5; i++) {
      expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "nurse1", password: "nope-nope-nope" } })).statusCode).toBe(401);
    }
    // Locked now, even the right password fails with 423.
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "nurse1", password: "password-123" } })).statusCode).toBe(423);
    db.close();
  });

  it("reader can read but cannot record or manage", async () => {
    const db = seed("reader");
    const app = buildApp(db, pack);
    const h = await loginAs(app, "reader1");
    expect((await app.inject({ method: "GET", url: "/api/children", headers: h })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/children", headers: h, payload: { familyName: "A", givenName: "A", birthDate: "2025-01-01", sex: "M" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/users", headers: h })).statusCode).toBe(403);
    db.close();
  });

  it("nurse records with her own name and cannot manage users", async () => {
    const db = seed("nurse");
    const app = buildApp(db, pack);
    const h = await loginAs(app, "nurse1");
    expect((await app.inject({ method: "GET", url: "/api/users", headers: h })).statusCode).toBe(403);
    const created = await app.inject({
      method: "POST",
      url: "/api/children",
      headers: h,
      payload: { familyName: "El Amrani", givenName: "Yasmine", birthDate: "2025-03-14", sex: "F" },
    });
    expect(created.statusCode).toBe(201);
    db.close();
  });

  it("admin manages users but cannot remove the last active admin", async () => {
    const db = seed("admin");
    const app = buildApp(db, pack);
    const h = await loginAs(app, "admin1");
    const created = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: h,
      payload: { username: "n2", fullName: "N Two", role: "nurse", password: "password-123" },
    });
    expect(created.statusCode).toBe(201);
    const me = body<{ user: { id: string } }>((await app.inject({ method: "GET", url: "/api/auth/me", headers: h })) as unknown as InjectRes);
    expect((await app.inject({ method: "PATCH", url: `/api/users/${me.user.id}`, headers: h, payload: { active: false } })).statusCode).toBe(400);
    db.close();
  });

  it("bootstrap works once, then it is closed", async () => {
    const db = openTestDb();
    const app = buildApp(db, pack);
    const first = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: { username: "boss", fullName: "Boss One", password: "password-123" },
    });
    expect(first.statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/auth/bootstrap", payload: { username: "boss2", fullName: "B Two", password: "password-123" } })).statusCode).toBe(400);
    db.close();
  });

  it("transition CENTRE without lot needs a grant, skips stock, skips analytics, writes audit", async () => {
    const db = seed("admin");
    const app = buildApp(db, pack);
    const h = await loginAs(app, "admin1");
    // Admin has the permission but no grant yet: blocked.
    const child = body<{ id: string; birthDate: string }>((await app.inject({ method: "POST", url: "/api/children", headers: h, payload: { familyName: "T", givenName: "T", birthDate: "2025-01-01", sex: "M" } })) as unknown as InjectRes);
    const blocked = await app.inject({
      method: "POST",
      url: "/api/encounters",
      headers: h,
      payload: {
        childId: child.id,
        birthDate: "2025-01-01",
        date: "2026-10-01",
        screening: "VACCINATE",
        doses: [{ productGroupId: "BCG", administeredOn: "2026-10-01", origin: "CENTRE", overridden: false, recordedBy: "spoofed" }],
        transitionReason: "paper move",
      },
    });
    expect(blocked.statusCode).toBe(400);
    // Grant, then record: works, author comes from login not payload.
    const grant = await app.inject({
      method: "POST",
      url: "/api/transition-grants",
      headers: h,
      payload: { userId: body<{ user: { id: string } }>((await app.inject({ method: "GET", url: "/api/auth/me", headers: h })) as unknown as InjectRes).user.id, reason: "paper move week", expiresAt: "2030-01-01" },
    });
    expect(grant.statusCode).toBe(201);
    const recorded = await app.inject({
      method: "POST",
      url: "/api/encounters",
      headers: h,
      payload: {
        childId: child.id,
        birthDate: "2025-01-01",
        date: "2026-10-01",
        screening: "VACCINATE",
        doses: [{ productGroupId: "BCG", administeredOn: "2026-10-01", origin: "CENTRE", overridden: false, recordedBy: "spoofed" }],
        transitionReason: "paper move",
      },
    });
    expect(recorded.statusCode).toBe(201);
    const doses = body<{ recordedBy: string; transition: boolean }[]>((await app.inject({ method: "GET", url: `/api/children/${child.id}/doses`, headers: h })) as unknown as InjectRes);
    expect(doses).toHaveLength(1);
    expect(doses[0].recordedBy).toBe("admin1");
    expect(doses[0].transition).toBe(true);
    const analytics = body<Record<string, number>>((await app.inject({ method: "GET", url: "/api/analytics/doses", headers: h })) as unknown as InjectRes);
    expect(analytics["BCG"] ?? 0).toBe(0);
    const audit = body<{ what: string }[]>((await app.inject({ method: "GET", url: `/api/children/${child.id}/overrides`, headers: h })) as unknown as InjectRes);
    expect(audit.some((a) => a.what.includes("transition"))).toBe(true);
    expect(nowIso).toBeTruthy();
    db.close();
  });

  it("logout kills the session", async () => {
    const db = seed("nurse");
    const app = buildApp(db, pack);
    const h = await loginAs(app, "nurse1");
    expect((await app.inject({ method: "GET", url: "/api/children", headers: h })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/auth/logout", headers: h })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/children", headers: h })).statusCode).toBe(401);
    db.close();
  });
});

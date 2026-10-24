import { describe, it, expect } from "vitest";
import { openTestDb, adminHeaders } from "./db-helper";
import { createChild } from "../../src/infra/repos/children";
import { insertOverride, listOverridesByChild, listRecentOverrides, listAuditLog } from "../../src/infra/repos/audit";
import { createUser } from "../../src/infra/repos/auth";
import { loadSchedulePack } from "../../src/infra/packs/loader";
import { buildApp } from "../../src/api/app";
import * as audit from "../../src/infra/repos/audit";

const pack = loadSchedulePack("MA");

describe("override audit trail", () => {
  it("records who/what/why/when and exposes no mutation interface", () => {
    const db = openTestDb();
    const child = createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    insertOverride(db, {
      childId: child.id,
      author: "nurse1",
      what: "PENTA dose 1 day early",
      reason: "session day constraint, clinician approved",
      createdAt: "2026-10-09T10:00:00",
    });
    const entries = listOverridesByChild(db, child.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].author).toBe("nurse1");
    // Append-only by construction: no update/delete exported.
    expect("updateOverride" in audit).toBe(false);
    expect("deleteOverride" in audit).toBe(false);
    db.close();
  });

  it("lists recent overrides newest-first with child and visit context", () => {
    const db = openTestDb();
    const a = createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    const b = createChild(db, { familyName: "B", givenName: "B", birthDate: "2025-02-02" });
    insertOverride(db, { childId: a.id, author: "nurse1", what: "w1", reason: "r1", createdAt: "2026-10-09T10:00:00.000Z" });
    insertOverride(db, { childId: b.id, author: "admin1", what: "w2", reason: "r2", createdAt: "2026-10-10T10:00:00.000Z" });
    const rows = listRecentOverrides(db, 10);
    expect(rows.map((r) => r.what)).toEqual(["w2", "w1"]);
    expect(rows[0].childName).toBe("B B");
    expect(rows[1].childName).toBe("A A");
    db.close();
  });

  it("serves the trail to audit viewers only, bounded", async () => {
    const db = openTestDb();
    const app = buildApp(db, pack);
    const admin = await adminHeaders(db, app);
    const child = createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    insertOverride(db, { childId: child.id, author: "nurse1", what: "w", reason: "r", createdAt: "2026-10-09T10:00:00.000Z" });
    expect((await app.inject({ method: "GET", url: "/api/overrides" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/overrides", headers: admin })).statusCode).toBe(200);
    const rows = JSON.parse((await app.inject({ method: "GET", url: "/api/overrides?limit=1", headers: admin })).body) as unknown[];
    expect(rows).toHaveLength(1);
    // Nurse has no audit.view.
    createUser(db, { username: "n1", fullName: "N One", role: "nurse", password: "password-123", createdAt: "2026-10-13T10:00:00.000Z" });
    const login = JSON.parse((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "n1", password: "password-123" } })).body) as { sessionId: string };
    expect((await app.inject({ method: "GET", url: "/api/overrides", headers: { "x-api-token": login.sessionId } })).statusCode).toBe(403);
    db.close();
  });

  it("records every human write in the action log, newest first", async () => {
    const db = openTestDb();
    const app = buildApp(db, pack);
    const admin = await adminHeaders(db, app);
    // Register a child + add a lot + record a visit.
    const child = JSON.parse((await app.inject({ method: "POST", url: "/api/children", headers: admin, payload: { familyName: "A", givenName: "A", birthDate: "2025-01-01", sex: "M" } })).body) as { id: string };
    await app.inject({ method: "POST", url: "/api/lots", headers: admin, payload: { productGroupId: "BCG", lotNumber: "L1", expiryDate: "2027-01-01", coldChainOk: true, qtyOnHand: 5 } });
    const lots = JSON.parse((await app.inject({ method: "GET", url: "/api/lots?product=BCG", headers: admin })).body) as { id: string }[];
    const { todayLocal } = await import("../../src/infra/time");
    const today = todayLocal();
    await app.inject({
      method: "POST",
      url: "/api/encounters",
      headers: admin,
      payload: { childId: child.id, birthDate: "2025-01-01", date: today, screening: "VACCINATE", doses: [{ productGroupId: "BCG", administeredOn: today, origin: "CENTRE", overridden: false, recordedBy: "x", lotId: lots[0].id }] },
    });
    const rows = listAuditLog(db, 50);
    const actions = rows.map((r) => r.action);
    for (const a of ["encounter.record", "stock.lot_add", "child.register", "auth.login"]) {
      expect(actions).toContain(a);
    }
    expect(rows[0].createdAt >= rows[rows.length - 1].createdAt).toBe(true);
    // Served to audit viewers, blocked for nurses, bounded.
    expect((await app.inject({ method: "GET", url: "/api/audit" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/audit", headers: admin })).statusCode).toBe(200);
    const one = JSON.parse((await app.inject({ method: "GET", url: "/api/audit?limit=1", headers: admin })).body) as unknown[];
    expect(one).toHaveLength(1);
    db.close();
  });
});

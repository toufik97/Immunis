import { describe, it, expect } from "vitest";
import { openTestDb, adminHeaders } from "./db-helper";
import { createChild } from "../../src/infra/repos/children";
import { insertOverride, listOverridesByChild, listRecentOverrides } from "../../src/infra/repos/audit";
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
});

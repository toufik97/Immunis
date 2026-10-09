import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { loadSchedulePack } from "../../src/infra/packs/loader";
import { buildApp } from "../../src/api/app";

const pack = loadSchedulePack("MA");

describe("api", () => {
  it("creates a child, confirms identity by birthDate, and records a visit", async () => {
    const db = openTestDb();
    const app = buildApp(db, pack);

    const created = await app.inject({
      method: "POST",
      url: "/api/children",
      payload: {
        familyName: "El Amrani",
        givenName: "Yasmine",
        birthDate: "2025-03-14",
        centreId: "CS01",
        firstVisitYear: "2026",
      },
    });
    expect(created.statusCode).toBe(201);
    const child = created.json() as { id: string; localIds: { value: string }[] };
    expect(child.localIds[0].value).toBe("1/2026");

    const found = await app.inject({ method: "GET", url: "/api/children?q=amrani" });
    expect(found.statusCode).toBe(200);
    expect((found.json() as unknown[])).toHaveLength(1);

    // Wrong birthDate confirmation is rejected before any action.
    const denied = await app.inject({
      method: "POST",
      url: "/api/encounters",
      payload: {
        childId: child.id,
        birthDate: "2000-01-01",
        date: "2026-10-09",
        screening: "VACCINATE",
        doses: [],
      },
    });
    expect(denied.statusCode).toBe(403);

    const visit = await app.inject({
      method: "POST",
      url: "/api/encounters",
      payload: {
        childId: child.id,
        birthDate: "2025-03-14",
        date: "2026-10-09",
        screening: "VACCINATE",
        weightKg: 8.5,
        doses: [
          {
            productGroupId: "BCG",
            administeredOn: "2026-10-09",
            origin: "EXTERNAL",
            recordedBy: "nurse1",
          },
        ],
        nextAppointmentDate: "2026-11-09",
      },
    });
    expect(visit.statusCode).toBe(201);

    const session = await app.inject({ method: "GET", url: "/api/sessions?date=2026-11-09" });
    expect(session.statusCode).toBe(200);
    expect((session.json() as { expected: unknown[] }).expected).toHaveLength(1);

    const noShows = await app.inject({ method: "GET", url: "/api/no-shows?asOf=2026-12-01" });
    expect((noShows.json() as unknown[])).toHaveLength(1);

    const evaluation = await app.inject({
      method: "POST",
      url: "/api/evaluate",
      payload: { childId: child.id, evaluationDate: "2026-10-09", projection: "next" },
    });
    expect(evaluation.statusCode).toBe(200);
    expect((evaluation.json() as { pack: { status: string } }).pack.status).toBeTruthy();
    db.close();
  });

  it("warns on duplicate registration but allows forced homonyms", async () => {
    const db = openTestDb();
    const app = buildApp(db, pack);
    const body = {
      familyName: "El Amrani",
      givenName: "Yasmine",
      birthDate: "2025-03-14",
      centreId: "CS01",
      firstVisitYear: "2026",
    };
    expect((await app.inject({ method: "POST", url: "/api/children", payload: body })).statusCode).toBe(201);
    const dup = await app.inject({ method: "POST", url: "/api/children", payload: body });
    expect(dup.statusCode).toBe(409);
    expect((dup.json() as { duplicates: unknown[] }).duplicates).toHaveLength(1);
    const forced = await app.inject({
      method: "POST",
      url: "/api/children",
      payload: { ...body, force: true },
    });
    expect(forced.statusCode).toBe(201);
    expect((forced.json() as { localIds: { value: string }[] }).localIds[0].value).toBe("2/2026");
    db.close();
  });

  it("serves pack metadata and centre-only analytics", async () => {
    const db = openTestDb();
    const app = buildApp(db, pack);
    const meta = await app.inject({ method: "GET", url: "/api/pack" });
    expect(meta.statusCode).toBe(200);
    expect((meta.json() as { country: string }).country).toBe("MA");
    const analytics = await app.inject({ method: "GET", url: "/api/analytics/doses" });
    expect(analytics.statusCode).toBe(200);
    expect(analytics.json()).toEqual({});
    db.close();
  });
});

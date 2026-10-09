import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { createChild } from "../../src/infra/repos/children";
import { recordEncounter, validateEncounterDates } from "../../src/infra/repos/encounters";
import { isFutureDate, nowIso, todayLocal } from "../../src/infra/time";
import { EncounterSchema } from "../../src/domain/encounter";

describe("centre time seam", () => {
  it("formats wall-clock dates and UTC stamps", () => {
    expect(todayLocal(new Date(2026, 9, 9, 12, 0, 0))).toBe("2026-10-09");
    expect(nowIso(new Date("2026-10-09T12:00:00.000Z"))).toBe("2026-10-09T12:00:00.000Z");
    expect(isFutureDate("2026-10-10", "2026-10-09")).toBe(true);
    expect(isFutureDate("2026-10-09", "2026-10-09")).toBe(false);
  });

  it("validates encounter dates against the injected today", () => {
    const parsed = EncounterSchema.parse({
      id: "e1",
      childId: "c1",
      date: "2026-10-09",
      screening: "VACCINATE",
      doses: [],
    });
    expect(() => validateEncounterDates(parsed, "2026-10-09")).not.toThrow();
    expect(() => validateEncounterDates(parsed, "2026-10-08")).toThrow(/future/);
  });

  it("records with injected today/nowIso", () => {
    const db = openTestDb();
    const child = createChild(db, { familyName: "T", givenName: "T", birthDate: "2025-01-01" });
    const enc = recordEncounter(
      db,
      { childId: child.id, date: "2026-10-09", screening: "VACCINATE", doses: [] },
      { today: "2026-10-09", nowIso: "2026-10-09T00:00:00.000Z" }
    );
    expect(enc.id).toBeTruthy();
    const outbox = db.prepare("SELECT created_at AS c FROM outbox").get() as { c: string };
    expect(outbox.c).toBe("2026-10-09T00:00:00.000Z");
    expect(() =>
      recordEncounter(
        db,
        { childId: child.id, date: "2026-10-09", screening: "VACCINATE", doses: [] },
        { today: "2026-10-08" }
      )
    ).toThrow(/future/);
    db.close();
  });
});

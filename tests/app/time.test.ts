import { describe, it, expect, vi, afterEach } from "vitest";
import { openTestDb } from "./db-helper";
import { createChild } from "../../src/infra/repos/children";
import { recordEncounter, validateEncounterDates } from "../../src/infra/repos/encounters";
import { centreOffsetLabel, centreTimeZone, isFutureDate, nowIso, todayLocal } from "../../src/infra/time";
import { EncounterSchema } from "../../src/domain/encounter";
import { loadSchedulePack } from "../../src/infra/packs/loader";
import { recordVisit } from "../../src/app/record-visit";

const pack = loadSchedulePack("MA");

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CENTRE_TZ;
});

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

  it("computes today in the configured centre zone, not the machine zone", () => {
    // Fixed-offset zones (no DST) keep this deterministic whatever the tzdata says.
    process.env.CENTRE_TZ = "Pacific/Kiritimati"; // UTC+14
    expect(centreTimeZone()).toBe("Pacific/Kiritimati");
    expect(todayLocal(new Date("2026-10-26T00:30:00.000Z"))).toBe("2026-10-26");
    expect(centreOffsetLabel(new Date("2026-10-26T00:30:00.000Z"))).toBe("GMT+14");
    process.env.CENTRE_TZ = "Pacific/Midway"; // UTC-11
    expect(todayLocal(new Date("2026-10-26T00:30:00.000Z"))).toBe("2026-10-25");
    expect(centreOffsetLabel(new Date("2026-10-26T00:30:00.000Z"))).toBe("GMT-11");
  });

  it("record gate follows the centre zone at the midnight boundary (2026-10-25 23:19Z)", () => {
    // The Enfant-243 incident: machine-local said the 26th while UTC said the 25th.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T23:19:00.000Z"));
    const attempt = (zone: string): "accepted" | "rejected" => {
      process.env.CENTRE_TZ = zone;
      const db = openTestDb();
      try {
        const child = createChild(db, { familyName: "T", givenName: "T", birthDate: "2025-01-01" });
        recordVisit(db, pack, child.birthDate, [], {
          childId: child.id,
          date: "2026-10-26",
          screening: "VACCINATE",
          doses: [
            {
              productGroupId: "PENTA",
              administeredOn: "2026-10-26",
              origin: "EXTERNAL",
              overridden: false,
              recordedBy: "nurse1",
            },
          ],
        });
        return "accepted";
      } catch (e) {
        expect(String((e as Error)?.message ?? e)).toMatch(/future|TODAY/i);
        return "rejected";
      } finally {
        db.close();
      }
    };
    // Centre east of the instant (already the 26th there): the 26th visit is legitimate.
    expect(attempt("Pacific/Kiritimati")).toBe("accepted");
    // Centre west of the instant (still the 25th there): the 26th visit is in the future.
    expect(attempt("Pacific/Midway")).toBe("rejected");
  });
});

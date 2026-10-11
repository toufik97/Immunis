import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { createChild } from "../../src/infra/repos/children";
import { recordEncounter } from "../../src/infra/repos/encounters";
import {
  createAppointment,
  listDue,
  markAppointment,
  listNoShows,
} from "../../src/infra/repos/appointments";
import { agendaFor, noShowsFor } from "../../src/app/sessions";

describe("appointments and no-shows", () => {
  it("lists expected children for a session day and detects no-shows", () => {
    const db = openTestDb();
    const a = createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    const b = createChild(db, { familyName: "B", givenName: "B", birthDate: "2025-01-01" });
    const apptA = createAppointment(db, { childId: a.id, dueDate: "2026-10-01", expectedProducts: ["PENTA"] });
    createAppointment(db, { childId: b.id, dueDate: "2026-10-01", expectedProducts: ["BCG"] });
    expect(listDue(db, "2026-10-01")).toHaveLength(2);
    expect(markAppointment(db, apptA.id, true)).toBe(true);
    expect(markAppointment(db, "does-not-exist", true)).toBe(false);
    const noShows = listNoShows(db, "2026-10-09");
    expect(noShows.map((n) => n.childId)).toEqual([b.id]);
    db.close();
  });

  it("survives a corrupt expected_products cell instead of crashing reads", () => {
    const db = openTestDb();
    const a = createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    const appt = createAppointment(db, { childId: a.id, dueDate: "2026-10-01", expectedProducts: ["PENTA"] });
    db.prepare("UPDATE appointments SET expected_products = 'oops' WHERE id = ?").run(appt.id);
    expect(listDue(db, "2026-10-01")[0].expectedProducts).toEqual([]);
    db.close();
  });

  it("builds a session agenda grouped by day, ignoring kept appointments", () => {
    const db = openTestDb();
    const a = createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    const b = createChild(db, { familyName: "B", givenName: "B", birthDate: "2025-01-01" });
    const kept = createAppointment(db, { childId: a.id, dueDate: "2026-10-01", expectedProducts: ["PENTA", "VPO"] });
    createAppointment(db, { childId: b.id, dueDate: "2026-10-01", expectedProducts: ["BCG"] });
    createAppointment(db, { childId: a.id, dueDate: "2026-10-05", expectedProducts: ["RR"] });
    expect(markAppointment(db, kept.id, true)).toBe(true);
    expect(agendaFor(db, "2026-10-01", "2026-10-31")).toEqual([
      { date: "2026-10-01", children: 1, doses: 1 },
      { date: "2026-10-05", children: 1, doses: 1 },
    ]);
    expect(agendaFor(db, "2026-11-01", "2026-11-30")).toEqual([]);
    db.close();
  });

  it("enriches no-shows with last visit and days overdue", () => {
    const db = openTestDb();
    const a = createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    const b = createChild(db, { familyName: "B", givenName: "B", birthDate: "2025-01-01" });
    recordEncounter(db, { childId: a.id, date: "2026-09-20", screening: "VACCINATE" }, { today: "2026-09-20" });
    recordEncounter(db, { childId: a.id, date: "2026-09-25", screening: "VACCINATE" }, { today: "2026-09-25" });
    createAppointment(db, { childId: a.id, dueDate: "2026-10-01", expectedProducts: ["PENTA"] });
    createAppointment(db, { childId: b.id, dueDate: "2026-10-03", expectedProducts: ["BCG"] });
    const rows = noShowsFor(db, "2026-10-09");
    expect(rows.map((r) => [r.childId, r.lastVisitDate, r.daysOverdue])).toEqual([
      [a.id, "2026-09-25", 8],
      [b.id, null, 6],
    ]);
    db.close();
  });
});

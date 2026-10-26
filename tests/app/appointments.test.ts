import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { createChild } from "../../src/infra/repos/children";
import { recordEncounter } from "../../src/infra/repos/encounters";
import {
  appendProducts,
  createAppointment,
  deleteAppointment,
  findPendingByChildDateSlot,
  listByChild,
  listDue,
  listNoShows,
  unionProducts,
  updateAppointment,
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
    db.prepare("UPDATE appointments SET kept = 1 WHERE id = ?").run(apptA.id);
    expect(listDue(db, "2026-10-01")).toHaveLength(1);
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
    db.prepare("UPDATE appointments SET kept = 1 WHERE id = ?").run(kept.id);
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

  it("updates a future pending appointment in place", () => {
    const db = openTestDb();
    const a = createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    const appt = createAppointment(db, { childId: a.id, dueDate: "2026-10-01", expectedProducts: ["PENTA"] });
    const updated = updateAppointment(db, appt.id, { dueDate: "2026-10-08", slot: "PM", expectedProducts: ["PENTA", "VPO"] });
    expect(updated).toMatchObject({ id: appt.id, dueDate: "2026-10-08", slot: "PM", expectedProducts: ["PENTA", "VPO"], kept: null });
    expect(updateAppointment(db, "missing", { dueDate: "2026-10-08", slot: "AM", expectedProducts: [] })).toBeNull();
    db.close();
  });

  it("lists one child's appointments oldest-first, other children excluded", () => {
    const db = openTestDb();
    const a = createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    const b = createChild(db, { familyName: "B", givenName: "B", birthDate: "2025-01-01" });
    createAppointment(db, { childId: a.id, dueDate: "2026-10-05", expectedProducts: ["RR"] });
    createAppointment(db, { childId: a.id, dueDate: "2026-10-01", expectedProducts: ["PENTA"] });
    createAppointment(db, { childId: b.id, dueDate: "2026-10-01", expectedProducts: ["BCG"] });
    expect(listByChild(db, a.id).map((r) => r.dueDate)).toEqual(["2026-10-01", "2026-10-05"]);
    expect(listByChild(db, b.id)).toHaveLength(1);
    expect(listByChild(db, "missing")).toEqual([]);
    db.close();
  });

  it("finds same-day same-slot pending rows but never across slots or children", () => {
    const db = openTestDb();
    const a = createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    const b = createChild(db, { familyName: "B", givenName: "B", birthDate: "2025-01-01" });
    const am = createAppointment(db, { childId: a.id, dueDate: "2026-11-11", slot: "AM", expectedProducts: ["PENTA"] });
    createAppointment(db, { childId: a.id, dueDate: "2026-11-11", slot: "PM", expectedProducts: ["BCG"] });
    createAppointment(db, { childId: b.id, dueDate: "2026-11-11", slot: "AM", expectedProducts: ["BCG"] });
    expect(findPendingByChildDateSlot(db, a.id, "2026-11-11", "AM")?.id).toBe(am.id);
    expect(findPendingByChildDateSlot(db, a.id, "2026-11-11", "PM")?.id).not.toBe(am.id);
    expect(findPendingByChildDateSlot(db, b.id, "2026-11-11", "AM")?.id).not.toBe(am.id);
    expect(findPendingByChildDateSlot(db, a.id, "2026-11-12", "AM")).toBeNull();
    // Resolved rows never match: kept history is not a merge target.
    db.prepare("UPDATE appointments SET kept = 1 WHERE id = ?").run(am.id);
    expect(findPendingByChildDateSlot(db, a.id, "2026-11-11", "AM")).toBeNull();
    db.close();
  });

  it("appends products as a union without duplicates", () => {
    expect(unionProducts(["PENTA"], ["BCG", "PENTA"])).toEqual(["PENTA", "BCG"]);
    const db = openTestDb();
    const a = createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    const appt = createAppointment(db, { childId: a.id, dueDate: "2026-11-11", slot: "AM", expectedProducts: ["PENTA"] });
    const merged = appendProducts(db, appt.id, ["BCG", "PENTA"]);
    expect(merged?.expectedProducts).toEqual(["PENTA", "BCG"]);
    expect(listByChild(db, a.id)).toHaveLength(1);
    expect(appendProducts(db, "missing", ["BCG"])).toBeNull();
    db.close();
  });

  it("deletes a row outright", () => {
    const db = openTestDb();
    const a = createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    const appt = createAppointment(db, { childId: a.id, dueDate: "2026-11-11", expectedProducts: ["PENTA"] });
    expect(deleteAppointment(db, appt.id)).toBe(true);
    expect(listByChild(db, a.id)).toEqual([]);
    expect(deleteAppointment(db, appt.id)).toBe(false);
    db.close();
  });
});

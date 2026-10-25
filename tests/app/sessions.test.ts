import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { registerChild } from "../../src/app/register-child";
import { createAppointment, markAppointment } from "../../src/infra/repos/appointments";
import { addLot } from "../../src/infra/repos/stock";
import { recordEncounter } from "../../src/infra/repos/encounters";
import { noShowsFor, sessionFor } from "../../src/app/sessions";

function child(db: never, givenName: string) {
  const r = registerChild(db as never, {
    familyName: "F",
    givenName,
    birthDate: "2025-01-01",
    sex: "F",
    address: `${givenName}-addr`,
    centreId: "CS01",
    firstVisitYear: "2026",
  });
  if (r.status !== "created") throw new Error("register failed");
  return r.child;
}

describe("sessions seam", () => {
  it("enriches expected rows + counters in one call", () => {
    const db = openTestDb();
    const a = child(db as never, "A");
    const b = child(db as never, "B");
    createAppointment(db, { childId: a.id, dueDate: "2026-11-09", expectedProducts: ["PENTA", "VPO"] });
    createAppointment(db, { childId: b.id, dueDate: "2026-11-09", expectedProducts: ["PENTA"] });

    const s = sessionFor(db, "2026-11-09");
    expect(s.counters.children).toBe(2);
    expect(s.counters.dosesByProduct).toEqual({ PENTA: 2, VPO: 1 });
    expect(s.expected.map((e) => e.childName).sort()).toEqual(["A F", "B F"]);
    expect(s.expected.every((e) => e.localIds.length === 1 && e.address?.endsWith("-addr"))).toBe(true);
    db.close();
  });

  it("lists no-shows excluding kept appointments", () => {
    const db = openTestDb();
    const a = child(db as never, "A");
    const b = child(db as never, "B");
    const apptA = createAppointment(db, { childId: a.id, dueDate: "2026-10-01", expectedProducts: ["BCG"] });
    createAppointment(db, { childId: b.id, dueDate: "2026-10-01", expectedProducts: ["BCG"] });
    markAppointment(db, apptA.id, true);

    const rows = noShowsFor(db, "2026-12-01");
    expect(rows.map((r) => r.childId)).toEqual([b.id]);
    expect(rows[0].childName).toBe("B F");
    db.close();
  });

  it("marks pending appointments kept when a visit is recorded", () => {
    const db = openTestDb();
    const a = child(db as never, "A");
    const b = child(db as never, "B");
    createAppointment(db, { childId: a.id, dueDate: "2026-10-09", expectedProducts: ["BCG"] });
    createAppointment(db, { childId: b.id, dueDate: "2026-10-01", expectedProducts: ["BCG"] });
    createAppointment(db, { childId: b.id, dueDate: "2026-12-01", expectedProducts: ["BCG"] });

    recordEncounter(
      db,
      { childId: a.id, date: "2026-10-09", screening: "VACCINATE", doses: [] },
      { today: "2026-10-09" }
    );
    // Same-day visit clears the session row and prevents a next-day no-show.
    expect(sessionFor(db, "2026-10-09").expected.map((e) => e.childId)).toEqual([]);
    expect(noShowsFor(db, "2026-10-10").map((r) => r.childId)).toEqual([b.id]);
    const keptOf = (childId: string, due: string) =>
      (db.prepare("SELECT kept AS k FROM appointments WHERE child_id = ? AND due_date = ?").get(childId, due) as { k: number | null }).k;
    expect(keptOf(a.id, "2026-10-09")).toBe(1);

    // Late visit records the overdue row as missed (not kept) and leaves the future pending.
    recordEncounter(
      db,
      { childId: b.id, date: "2026-10-09", screening: "VACCINATE", doses: [] },
      { today: "2026-10-09" }
    );
    expect(keptOf(b.id, "2026-10-01")).toBe(0);
    expect(keptOf(b.id, "2026-12-01")).toBe(null);
    expect(noShowsFor(db, "2026-10-10")).toEqual([]);
    expect(sessionFor(db, "2026-12-01").expected.map((e) => e.childId)).toEqual([b.id]);
    db.close();
  });

  it("enriches large lists in chunks without hitting variable limits", () => {
    const db = openTestDb();
    for (let i = 0; i < 600; i++) {
      const c = child(db as never, `K${i}`);
      createAppointment(db, { childId: c.id, dueDate: "2026-10-01", expectedProducts: ["BCG"] });
    }
    const s = sessionFor(db, "2026-10-01");
    expect(s.expected).toHaveLength(600);
    expect(s.expected.every((e) => e.childName && e.localIds.length === 1)).toBe(true);
    expect(noShowsFor(db, "2026-10-02")).toHaveLength(600);
    db.close();
  });

  it("buckets catch-ups into probable (<7d) and possible (7–30d), oldest backlog excluded", () => {
    const db = openTestDb();
    const due = child(db as never, "Due");
    const prob = child(db as never, "Prob");
    const poss = child(db as never, "Poss");
    const old = child(db as never, "Old");
    const future = child(db as never, "Fut");
    createAppointment(db, { childId: due.id, dueDate: "2026-10-18", expectedProducts: ["BCG"] });
    createAppointment(db, { childId: prob.id, dueDate: "2026-10-16", expectedProducts: ["BCG"] });
    createAppointment(db, { childId: poss.id, dueDate: "2026-10-11", expectedProducts: ["BCG"] });
    createAppointment(db, { childId: old.id, dueDate: "2026-09-01", expectedProducts: ["BCG"] });
    createAppointment(db, { childId: future.id, dueDate: "2026-10-19", expectedProducts: ["BCG"] });

    const s = sessionFor(db, "2026-10-18");
    expect(s.expected.map((e) => e.childId)).toEqual([due.id]);
    expect(s.probable.map((e) => e.childId)).toEqual([prob.id]);
    expect(s.probable[0].daysOverdue).toBe(2);
    expect(s.probable[0].likelihood).toBe("probable");
    expect(s.possible.map((e) => e.childId)).toEqual([poss.id]);
    expect(s.possible[0].daysOverdue).toBe(7);
    // Legacy shape still means the due tier only.
    expect(s.counters.children).toBe(1);
    expect(s.tiers.probable.children).toBe(1);
    expect(s.tiers.possible.children).toBe(1);
    expect(s.backlog.children).toBe(1);
    db.close();
  });

  it("excludes kept appointments from catch-up tiers", () => {
    const db = openTestDb();
    const a = child(db as never, "A");
    const appt = createAppointment(db, { childId: a.id, dueDate: "2026-10-16", expectedProducts: ["BCG"] });
    markAppointment(db, appt.id, true);
    const s = sessionFor(db, "2026-10-18");
    expect(s.probable).toEqual([]);
    expect(s.possible).toEqual([]);
    expect(s.backlog.children).toBe(0);
    db.close();
  });

  it("reports past-session results: planned vs seen vs CENTRE doses given", () => {
    const db = openTestDb();
    const a = child(db as never, "A");
    const b = child(db as never, "B");
    createAppointment(db, { childId: a.id, dueDate: "2026-10-10", expectedProducts: ["BCG"] });
    createAppointment(db, { childId: b.id, dueDate: "2026-10-10", expectedProducts: ["BCG", "VPO"] });
    const lot = addLot(db, { productGroupId: "BCG", lotNumber: "L1", expiryDate: "2027-01-01", coldChainOk: true, qtyOnHand: 10 });
    recordEncounter(
      db,
      {
        childId: a.id,
        date: "2026-10-10",
        screening: "VACCINATE",
        doses: [{ productGroupId: "BCG", administeredOn: "2026-10-10", origin: "CENTRE", lotId: lot.id, recordedBy: "nurse" }],
      },
      { today: "2026-10-10" }
    );
    recordEncounter(db, { childId: b.id, date: "2026-10-10", screening: "VACCINATE", doses: [] }, { today: "2026-10-10" });

    const s = sessionFor(db, "2026-10-10");
    expect(s.results.planned).toBe(2);
    expect(s.results.plannedChildren).toBe(2);
    expect(s.results.kept).toBe(2);
    expect(s.results.childrenSeen).toBe(2);
    expect(s.results.dosesByProduct).toEqual({ BCG: 1 });
    expect(s.results.plannedDoses).toEqual({ BCG: 2, VPO: 1 });
    expect(s.results.seen.map((r) => r.childId).sort()).toEqual([a.id, b.id].sort());
    expect(s.results.seen.find((r) => r.childId === a.id)?.dosesGiven).toEqual(["BCG"]);
    expect(s.results.seen.find((r) => r.childId === b.id)?.dosesGiven).toEqual([]);
    expect(s.results.missed).toEqual([]);
    db.close();
  });

  it("lists missed due appointments in past-session results", () => {
    const db = openTestDb();
    const a = child(db as never, "A");
    const b = child(db as never, "B");
    createAppointment(db, { childId: a.id, dueDate: "2026-10-10", expectedProducts: ["BCG"] });
    createAppointment(db, { childId: b.id, dueDate: "2026-10-10", expectedProducts: ["BCG"] });
    recordEncounter(db, { childId: a.id, date: "2026-10-10", screening: "VACCINATE", doses: [] }, { today: "2026-10-10" });

    const s = sessionFor(db, "2026-10-10");
    expect(s.results.kept).toBe(1);
    expect(s.results.childrenSeen).toBe(1);
    expect(s.results.missed.map((r) => r.childId)).toEqual([b.id]);
    expect(s.results.seen.map((r) => r.childId)).toEqual([a.id]);
    db.close();
  });

  it("flags seen rows as booked vs walk-in with expected doses", () => {
    const db = openTestDb();
    const a = child(db as never, "A");
    const w = child(db as never, "W");
    createAppointment(db, { childId: a.id, dueDate: "2026-10-10", expectedProducts: ["BCG", "VPO"] });
    recordEncounter(db, { childId: a.id, date: "2026-10-10", screening: "VACCINATE", doses: [] }, { today: "2026-10-10" });
    recordEncounter(db, { childId: w.id, date: "2026-10-10", screening: "VACCINATE", doses: [] }, { today: "2026-10-10" });

    const s = sessionFor(db, "2026-10-10");
    expect(s.results.seen.find((r) => r.childId === a.id)?.bookedToday).toBe(true);
    expect(s.results.seen.find((r) => r.childId === a.id)?.expectedToday).toEqual(["BCG", "VPO"]);
    expect(s.results.seen.find((r) => r.childId === w.id)?.bookedToday).toBe(false);
    expect(s.results.seen.find((r) => r.childId === w.id)?.expectedToday).toEqual([]);
    db.close();
  });
});

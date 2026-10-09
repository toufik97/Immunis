import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { registerChild } from "../../src/app/register-child";
import { createAppointment, markAppointment } from "../../src/infra/repos/appointments";
import { noShowsFor, sessionFor } from "../../src/app/sessions";

function child(db: never, givenName: string) {
  const r = registerChild(db as never, {
    familyName: "F",
    givenName,
    birthDate: "2025-01-01",
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
});

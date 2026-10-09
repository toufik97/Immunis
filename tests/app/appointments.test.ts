import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { createChild } from "../../src/infra/repos/children";
import {
  createAppointment,
  listDue,
  markAppointment,
  listNoShows,
} from "../../src/infra/repos/appointments";

describe("appointments and no-shows", () => {
  it("lists expected children for a session day and detects no-shows", () => {
    const db = openTestDb();
    const a = createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    const b = createChild(db, { familyName: "B", givenName: "B", birthDate: "2025-01-01" });
    const apptA = createAppointment(db, { childId: a.id, dueDate: "2026-10-01", expectedProducts: ["PENTA"] });
    createAppointment(db, { childId: b.id, dueDate: "2026-10-01", expectedProducts: ["BCG"] });
    expect(listDue(db, "2026-10-01")).toHaveLength(2);
    markAppointment(db, apptA.id, true);
    const noShows = listNoShows(db, "2026-10-09");
    expect(noShows.map((n) => n.childId)).toEqual([b.id]);
    db.close();
  });
});

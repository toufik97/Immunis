import { describe, it, expect, vi, afterEach } from "vitest";
import { openTestDb, adminHeaders } from "./db-helper";
import { loadSchedulePack } from "../../src/infra/packs/loader";
import { buildApp } from "../../src/api/app";
import { createChild } from "../../src/infra/repos/children";
import { createAppointment } from "../../src/infra/repos/appointments";
import { checkBooking, suggestBookingSlot, weekdayOf } from "../../src/app/scheduling";
import {
  replaceSchedulingRules,
  getBookingHorizon,
  setBookingHorizon,
  listClosures,
  addClosure,
  deleteClosure,
  upsertAutoClosures,
  countCellBookings,
} from "../../src/infra/repos/scheduling";

const pack = loadSchedulePack("MA");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scheduling rules", () => {
  it("starts unconstrained: no rows, no horizon, no closures", () => {
    const db = openTestDb();
    expect(
      checkBooking(db, { dueDate: "2026-11-24", slot: "AM", expectedProducts: ["PENTA"], referenceDate: "2026-10-27" })
    ).toEqual([]);
    expect(getBookingHorizon(db)).toBeNull();
    db.close();
  });

  it("maps civil dates to weekdays (0=Sunday)", () => {
    expect(weekdayOf("2026-11-24")).toBe(2); // Tuesday
    expect(weekdayOf("2026-11-29")).toBe(0); // Sunday
  });

  it("warns on closed cells and full slots, per group with global fallback", () => {
    const db = openTestDb();
    replaceSchedulingRules(db, [
      { scope: "global", weekday: 2, slot: "AM", cap: 1 },
      { scope: "BCG", weekday: 1, slot: "AM", cap: 1 },
    ]);
    const child = createChild(db, { familyName: "G", givenName: "G", birthDate: "2026-01-01" });
    // Sunday has no global row at all: closed only where cap is explicitly 0.
    expect(
      checkBooking(db, { dueDate: "2026-11-29", slot: "AM", expectedProducts: ["PENTA"], referenceDate: "2026-10-27" })
    ).toEqual([]);
    // Tuesday AM global cap 1, empty: no finding.
    expect(
      checkBooking(db, { dueDate: "2026-11-24", slot: "AM", expectedProducts: ["PENTA"], referenceDate: "2026-10-27" })
    ).toEqual([]);
    createAppointment(db, { childId: child.id, dueDate: "2026-11-24", slot: "AM", expectedProducts: ["PENTA"] });
    // Tuesday AM now full for global; BCG falls back to global on Tuesday.
    const full = checkBooking(db, {
      dueDate: "2026-11-24",
      slot: "AM",
      expectedProducts: ["PENTA", "BCG"],
      referenceDate: "2026-10-27",
    });
    expect(full.map((i) => [i.code, i.productGroupId])).toEqual([
      ["slot_full", "PENTA"],
      ["slot_full", "BCG"],
    ]);
    expect(full[0].booked).toBe(1);
    // BCG Monday AM has its own cell: empty, no finding (no fallback needed).
    expect(
      checkBooking(db, { dueDate: "2026-11-23", slot: "AM", expectedProducts: ["BCG"], referenceDate: "2026-10-27" })
    ).toEqual([]);
    db.close();
  });

  it("counts legacy NULL-slot bookings as AM", () => {
    const db = openTestDb();
    const child = createChild(db, { familyName: "G", givenName: "G", birthDate: "2026-01-01" });
    db.prepare("INSERT INTO appointments (id, child_id, due_date, expected_products, kept, slot) VALUES ('x', ?, '2026-11-24', '[]', NULL, NULL)").run(
      child.id
    );
    expect(countCellBookings(db, "2026-11-24", "AM")).toBe(1);
    expect(countCellBookings(db, "2026-11-24", "PM")).toBe(0);
    db.close();
  });

  it("treats cap 0 as a closed cell", () => {
    const db = openTestDb();
    replaceSchedulingRules(db, [{ scope: "global", weekday: 5, slot: "PM", cap: 0 }]);
    expect(
      checkBooking(db, { dueDate: "2026-11-27", slot: "PM", expectedProducts: [], referenceDate: "2026-10-27" })
    ).toEqual([{ code: "closed_day", productGroupId: null, booked: null, cap: 0, limit: null }]);
    // Same Friday morning has no row: unconstrained.
    expect(
      checkBooking(db, { dueDate: "2026-11-27", slot: "AM", expectedProducts: [], referenceDate: "2026-10-27" })
    ).toEqual([]);
    db.close();
  });

  it("blocks closure days and beyond-horizon dates", () => {
    const db = openTestDb();
    addClosure(db, { date: "2026-12-25", label: "Noël" });
    setBookingHorizon(db, 30);
    expect(getBookingHorizon(db)).toBe(30);
    const closed = checkBooking(db, {
      dueDate: "2026-12-25",
      slot: "AM",
      expectedProducts: [],
      referenceDate: "2026-10-27",
    });
    expect(closed.map((i) => i.code)).toEqual(["closure_day", "beyond_horizon"]);
    db.close();
  });

  it("anchors the horizon at the engine date, not the booking day", () => {
    const db = openTestDb();
    setBookingHorizon(db, 30);
    // Engine recommends 22 Nov, booked 25 Nov: 3 days of drift, no finding.
    expect(
      checkBooking(db, { dueDate: "2026-11-25", slot: "AM", expectedProducts: [], referenceDate: "2026-11-22" })
    ).toEqual([]);
    // Same booking day, 40 days past the recommendation: flagged.
    const late = checkBooking(db, {
      dueDate: "2027-01-01",
      slot: "AM",
      expectedProducts: [],
      referenceDate: "2026-11-22",
    });
    expect(late.map((i) => i.code)).toEqual(["beyond_horizon"]);
    db.close();
  });

  it("lets manual closures win over pulled ones and deletes either", () => {
    const db = openTestDb();
    addClosure(db, { date: "2026-04-02", label: "Aid (sighting)" });
    const added = upsertAutoClosures(db, [
      { date: "2026-04-02", label: "Eid al-Fitr" },
      { date: "2026-05-01", label: "Fête du Travail" },
    ]);
    expect(added).toBe(1);
    expect(listClosures(db, "2026").find((c) => c.date === "2026-04-02")).toMatchObject({
      label: "Aid (sighting)",
      source: "manual",
    });
    expect(deleteClosure(db, "2026-05-01")).toBe(true);
    expect(deleteClosure(db, "2026-05-01")).toBe(false);
    db.close();
  });
});

describe("booking suggestion", () => {
  async function setup() {
    const db = openTestDb();
    const app = buildApp(db, pack);
    const h = await adminHeaders(db, app);
    return { db, app, h };
  }

  it("proposes the engine date when nothing constrains it", () => {
    const db = openTestDb();
    expect(
      suggestBookingSlot(db, { fromDate: "2026-11-24", expectedProducts: ["PENTA"], referenceDate: "2026-10-27" })
    ).toEqual({ date: "2026-11-24", slot: "AM" });
    db.close();
  });

  it("skips closed days and prefers the other slot the same day", () => {
    const db = openTestDb();
    replaceSchedulingRules(db, [
      { scope: "global", weekday: 0, slot: "AM", cap: 0 },
      { scope: "global", weekday: 0, slot: "PM", cap: 0 },
      { scope: "global", weekday: 1, slot: "AM", cap: 0 },
    ]);
    // Sunday all closed -> Monday; Monday AM closed but PM open -> same-day PM.
    expect(
      suggestBookingSlot(db, { fromDate: "2026-11-29", expectedProducts: [], referenceDate: "2026-10-27" })
    ).toEqual({ date: "2026-11-30", slot: "PM" });
    db.close();
  });

  it("lands on the intersection day for co-due products", () => {
    const db = openTestDb();
    // RR Monday-only, VPI Wednesday-only, global open: engine Thursday books both via fallback.
    replaceSchedulingRules(db, [
      { scope: "RR", weekday: 1, slot: "AM", cap: 10 },
      { scope: "VPI", weekday: 3, slot: "AM", cap: 10 },
    ]);
    expect(
      suggestBookingSlot(db, { fromDate: "2026-11-26", expectedProducts: ["RR", "VPI"], referenceDate: "2026-10-27" })
    ).toEqual({ date: "2026-11-26", slot: "AM" });
    db.close();
  });

  it("returns null when nothing is clean inside the horizon", () => {
    const db = openTestDb();
    replaceSchedulingRules(db, [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [{ scope: "global", weekday, slot: "AM" as const, cap: 0 }]));
    setBookingHorizon(db, 7);
    // AM closed everywhere: same-day PM is the first clean cell.
    expect(
      suggestBookingSlot(db, { fromDate: "2026-11-24", expectedProducts: [], referenceDate: "2026-11-24" })
    ).toEqual({ date: "2026-11-24", slot: "PM" });
    // Both slots closed all week: nothing clean inside the horizon.
    replaceSchedulingRules(
      db,
      [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
        { scope: "global", weekday, slot: "AM" as const, cap: 0 },
        { scope: "global", weekday, slot: "PM" as const, cap: 0 },
      ])
    );
    expect(
      suggestBookingSlot(db, { fromDate: "2026-11-24", expectedProducts: [], referenceDate: "2026-11-24" })
    ).toBeNull();
    db.close();
  });

  it("serves the suggestion over HTTP", async () => {
    const { db, app, h } = await setup();
    replaceSchedulingRules(db, [{ scope: "global", weekday: 0, slot: "AM", cap: 0 }]);
    const res = await app.inject({
      method: "GET",
      url: "/api/scheduling/suggest?from=2026-11-29&products=PENTA",
      headers: h,
    });
    expect(res.statusCode).toBe(200);
    // Sunday AM closed, Sunday PM open.
    expect(JSON.parse(res.body)).toEqual({ date: "2026-11-29", slot: "PM" });
    db.close();
  });
});

describe("appointments booking gate", () => {
  async function setup() {
    const db = openTestDb();
    const app = buildApp(db, pack);
    const h = await adminHeaders(db, app);
    const child = createChild(db, { familyName: "G", givenName: "G", birthDate: "2026-01-01" });
    return { db, app, h, childId: child.id };
  }

  it("books freely when unconstrained and stores the slot", async () => {
    const { db, app, h, childId } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/api/appointments",
      headers: h,
      payload: { childId, dueDate: "2026-11-24", expectedProducts: ["PENTA"], slot: "PM" },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).slot).toBe("PM");
    db.close();
  });

  it("returns 409 with issues on a full slot, books with a reason", async () => {
    const { db, app, h, childId } = await setup();
    replaceSchedulingRules(db, [{ scope: "global", weekday: 2, slot: "AM", cap: 1 }]);
    createAppointment(db, { childId, dueDate: "2026-11-24", slot: "AM", expectedProducts: ["PENTA"] });
    const blocked = await app.inject({
      method: "POST",
      url: "/api/appointments",
      headers: h,
      payload: { childId, dueDate: "2026-11-24", slot: "AM", expectedProducts: ["PENTA"] },
    });
    expect(blocked.statusCode).toBe(409);
    expect(JSON.parse(blocked.body).issues).toEqual([
      { code: "slot_full", productGroupId: "PENTA", booked: 1, cap: 1, limit: null },
    ]);
    const forced = await app.inject({
      method: "POST",
      url: "/api/appointments",
      headers: h,
      payload: {
        childId,
        dueDate: "2026-11-24",
        slot: "AM",
        expectedProducts: ["PENTA"],
        overrideReason: "mother works Wednesdays",
      },
    });
    expect(forced.statusCode).toBe(201);
    const overrides = db
      .prepare("SELECT what, reason FROM overrides WHERE child_id = ?")
      .all(childId) as { what: string; reason: string }[];
    expect(overrides).toHaveLength(1);
    expect(overrides[0].reason).toBe("mother works Wednesdays");
    db.close();
  });

  it("serves scheduling prefs and closures over HTTP", async () => {
    const { db, app, h } = await setup();
    const put = await app.inject({
      method: "PUT",
      url: "/api/scheduling",
      headers: h,
      payload: { rules: [{ scope: "global", weekday: 1, slot: "AM", cap: 10 }], horizonDays: 60 },
    });
    expect(put.statusCode).toBe(200);
    expect(JSON.parse(put.body)).toEqual({
      rules: [{ scope: "global", weekday: 1, slot: "AM", cap: 10 }],
      horizonDays: 60,
    });
    const add = await app.inject({
      method: "POST",
      url: "/api/closures",
      headers: h,
      payload: { date: "2026-12-25", label: "Noël" },
    });
    expect(add.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: "/api/closures?year=2026", headers: h });
    expect(JSON.parse(list.body)).toHaveLength(1);
    const del = await app.inject({ method: "DELETE", url: "/api/closures/2026-12-25", headers: h });
    expect(del.statusCode).toBe(200);
    db.close();
  });

  it("pulls holidays from Nager.Date and caches them", async () => {
    const { db, app, h } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          { date: "2026-01-01", localName: "Nouvel An", name: "New Year's Day" },
          { date: "oops", localName: "Bad", name: "Bad" },
        ],
      }))
    );
    const res = await app.inject({ method: "POST", url: "/api/closures/pull", headers: h, payload: { year: 2026 } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { added: number };
    expect(body.added).toBe(1);
    expect(listClosures(db, "2026")[0]).toMatchObject({ date: "2026-01-01", source: "auto" });
    db.close();
  });
});

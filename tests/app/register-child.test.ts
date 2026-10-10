import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { findChildrenByName, getChild } from "../../src/infra/repos/children";
import { registerChild } from "../../src/app/register-child";

function count(db: { prepare(s: string): { get(): unknown } }, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe("registerChild seam", () => {
  it("creates with xx/yy atomically and increments per centre/year", () => {
    const db = openTestDb();
    const base = { familyName: "El Amrani", birthDate: "2025-03-14", centreId: "CS01", firstVisitYear: "2026" };
    const a = registerChild(db, { ...base, givenName: "Yasmine" });
    expect(a.status).toBe("created");
    if (a.status !== "created") return;
    expect(a.child.localIds).toEqual([{ centreId: "CS01", value: "1/2026" }]);

    const b = registerChild(db, { ...base, givenName: "Karim", force: true });
    if (b.status !== "created") throw new Error("expected created");
    expect(b.child.localIds[0].value).toBe("2/2026");

    // Search carries local ids without extra queries per row.
    const found = findChildrenByName(db, "amrani");
    expect(found).toHaveLength(2);
    expect(found.flatMap((c) => c.localIds.map((l) => l.value)).sort()).toEqual(["1/2026", "2/2026"]);
    db.close();
  });

  it("warns on duplicates without writing", () => {
    const db = openTestDb();
    const body = { familyName: "A", givenName: "A", birthDate: "2025-01-01", centreId: "CS01", firstVisitYear: "2026" };
    expect(registerChild(db, body).status).toBe("created");
    const before = count(db as never, "children");
    const dup = registerChild(db, body);
    expect(dup.status).toBe("duplicate");
    if (dup.status !== "duplicate") return;
    expect(dup.duplicates).toHaveLength(1);
    expect(count(db as never, "children")).toBe(before);
    const forced = registerChild(db, { ...body, force: true });
    expect(forced.status).toBe("created");
    db.close();
  });

  it("rejects half pairing without writing", () => {
    const db = openTestDb();
    expect(() =>
      registerChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01", centreId: "CS01" })
    ).toThrow(/required together/);
    expect(count(db as never, "children")).toBe(0);
    const created = registerChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    expect(created.status).toBe("created");
    if (created.status === "created") expect(getChild(db, created.child.id)?.localIds).toEqual([]);
    db.close();
  });

  it("rejects future and impossible birth dates without writing", () => {
    const db = openTestDb();
    expect(() => registerChild(db, { familyName: "A", givenName: "A", birthDate: "2030-05-01" })).toThrow(
      /in the future/
    );
    expect(() => registerChild(db, { familyName: "A", givenName: "A", birthDate: "2026-02-30" })).toThrow(
      /real YYYY-MM-DD/
    );
    expect(count(db as never, "children")).toBe(0);
    db.close();
  });
});

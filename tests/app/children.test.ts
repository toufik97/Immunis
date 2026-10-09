import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { openTestDb } from "./db-helper";
import { runMigrations } from "../../src/infra/db/migrate";
import { createChild, findChildrenByName, allocateLocalId, getChild } from "../../src/infra/repos/children";

describe("child registry", () => {
  it("creates a child and finds it by name", () => {
    const db = openTestDb();
    const child = createChild(db, {
      familyName: "El Amrani",
      givenName: "Yasmine",
      birthDate: "2025-03-14",
      fatherName: "Karim",
      motherName: "Salma",
      address: "Rue 12, Casablanca",
    });
    expect(child.id).toBeTruthy();
    expect(child.fatherName).toBe("Karim");
    expect(child.motherName).toBe("Salma");
    expect(child.address).toBe("Rue 12, Casablanca");
    const found = findChildrenByName(db, "amrani");
    expect(found.map((c) => c.id)).toContain(child.id);
    db.close();
  });

  it("allocates xx/yy local ids per centre and year", () => {
    const db = openTestDb();
    const a = createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    const b = createChild(db, { familyName: "B", givenName: "B", birthDate: "2025-02-02" });
    expect(allocateLocalId(db, a.id, "CS01", "2026")).toBe("1/2026");
    expect(allocateLocalId(db, b.id, "CS01", "2026")).toBe("2/2026");
    // Same child + same centre keeps its first-visit id: re-allocation fails.
    expect(() => allocateLocalId(db, a.id, "CS01", "2027")).toThrow();
    // New year resets the counter for new children; other centres are independent.
    const c = createChild(db, { familyName: "C", givenName: "C", birthDate: "2025-03-03" });
    expect(allocateLocalId(db, c.id, "CS01", "2027")).toBe("1/2027");
    expect(allocateLocalId(db, a.id, "CS02", "2026")).toBe("1/2026");
    db.close();
  });

  it("migrates a pre-attributes database without losing children", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(
      "CREATE TABLE children (id TEXT PRIMARY KEY, family_name TEXT NOT NULL, given_name TEXT NOT NULL, birth_date TEXT NOT NULL, parent_names TEXT, national_id TEXT)"
    );
    db.exec(
      "CREATE TABLE local_ids (child_id TEXT NOT NULL, centre_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (child_id, centre_id))"
    );
    db.prepare(
      "INSERT INTO children (id, family_name, given_name, birth_date) VALUES ('old-1', 'A', 'A', '2025-01-01')"
    ).run();
    runMigrations(db);
    const child = getChild(db, "old-1");
    expect(child?.familyName).toBe("A");
    const fresh = createChild(db, {
      familyName: "B",
      givenName: "B",
      birthDate: "2025-02-02",
      fatherName: "F",
      address: "Somewhere",
    });
    expect(fresh.fatherName).toBe("F");
    expect(fresh.address).toBe("Somewhere");
    db.close();
  });
});

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { openTestDb } from "./db-helper";
import { runMigrations } from "../../src/infra/db/migrate";
import { createChild, findChildrenByName, allocateLocalId, getChild, listChildren } from "../../src/infra/repos/children";

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

  it("treats % and _ as literal characters, not wildcards", () => {
    const db = openTestDb();
    createChild(db, { familyName: "El Amrani", givenName: "Yasmine", birthDate: "2025-03-14" });
    expect(findChildrenByName(db, "%")).toEqual([]);
    expect(findChildrenByName(db, "_")).toEqual([]);
    expect(findChildrenByName(db, "amrani")).toHaveLength(1);
    db.close();
  });

  it("lists every child for the registry browser", () => {
    const db = openTestDb();
    expect(listChildren(db)).toEqual([]);
    const a = createChild(db, { familyName: "B", givenName: "B", birthDate: "2025-01-01" });
    allocateLocalId(db, a.id, "CS01", "2026");
    createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    const all = listChildren(db);
    expect(all.map((c) => c.familyName)).toEqual(["A", "B"]);
    expect(all[1].localIds).toEqual([{ centreId: "CS01", value: "1/2026" }]);
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
    // Pre-field rows read back with unknown sex instead of crashing.
    expect(child?.sex).toBeNull();
    const fresh = createChild(db, {
      familyName: "B",
      givenName: "B",
      birthDate: "2025-02-02",
      sex: "F",
      fatherName: "F",
      address: "Somewhere",
    });
    expect(fresh.fatherName).toBe("F");
    expect(fresh.address).toBe("Somewhere");
    db.close();
  });

  it("persists sex and reads it back", () => {
    const db = openTestDb();
    const boy = createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01", sex: "M" });
    expect(boy.sex).toBe("M");
    expect(getChild(db, boy.id)?.sex).toBe("M");
    const unknown = createChild(db, { familyName: "B", givenName: "B", birthDate: "2025-01-01" });
    expect(unknown.sex).toBeNull();
    db.close();
  });
});

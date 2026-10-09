import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { createChild, findChildrenByName, allocateLocalId } from "../../src/infra/repos/children";

describe("child registry", () => {
  it("creates a child and finds it by name", () => {
    const db = openTestDb();
    const child = createChild(db, {
      familyName: "El Amrani",
      givenName: "Yasmine",
      birthDate: "2025-03-14",
      parentNames: "Karim / Salma",
    });
    expect(child.id).toBeTruthy();
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
});

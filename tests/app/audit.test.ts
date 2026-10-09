import { describe, it, expect } from "vitest";
import { openTestDb } from "./db-helper";
import { createChild } from "../../src/infra/repos/children";
import { insertOverride, listOverridesByChild } from "../../src/infra/repos/audit";
import * as audit from "../../src/infra/repos/audit";

describe("override audit trail", () => {
  it("records who/what/why/when and exposes no mutation interface", () => {
    const db = openTestDb();
    const child = createChild(db, { familyName: "A", givenName: "A", birthDate: "2025-01-01" });
    insertOverride(db, {
      childId: child.id,
      author: "nurse1",
      what: "PENTA dose 1 day early",
      reason: "session day constraint, clinician approved",
      createdAt: "2026-10-09T10:00:00",
    });
    const entries = listOverridesByChild(db, child.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].author).toBe("nurse1");
    // Append-only by construction: no update/delete exported.
    expect("updateOverride" in audit).toBe(false);
    expect("deleteOverride" in audit).toBe(false);
    db.close();
  });
});

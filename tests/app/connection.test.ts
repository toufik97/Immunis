import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../../src/infra/db/connection";

describe("openDb", () => {
  it("reuses one connection per path and isolates different paths", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "immunis-"));
    const a = path.join(dir, "a.db");
    const b = path.join(dir, "b.db");
    expect(openDb(a)).toBe(openDb(a));
    const dbA = openDb(a);
    const dbB = openDb(b);
    expect(dbB).not.toBe(dbA);
    dbA.prepare("INSERT INTO children (id, family_name, given_name, birth_date) VALUES ('x','A','A','2025-01-01')").run();
    expect(
      (dbB.prepare("SELECT COUNT(*) AS n FROM children").get() as { n: number }).n
    ).toBe(0);
    dbA.close();
    dbB.close();
  });
});

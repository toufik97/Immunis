import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/** Fresh isolated in-memory DB with schema + migrations applied (tests only). */
export function openTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(
    path.resolve(process.cwd(), "src", "infra", "db", "schema.sql"),
    "utf8"
  );
  db.exec(schema);
  return db;
}

/** Create an admin + session headers for API tests (login replaces the old shared token). */
export async function adminHeaders(
  db: Database.Database,
  app: { inject(o: unknown): Promise<{ body: string; statusCode: number }> },
  username = "admin1"
): Promise<Record<string, string>> {
  const { createUser } = await import("../../src/infra/repos/auth");
  try {
    createUser(db, {
      username,
      fullName: `${username} Full`,
      role: "admin",
      password: "password-123",
      mustChangePassword: false,
      createdAt: "2026-10-13T10:00:00.000Z",
    });
  } catch {
    /* already seeded */
  }
  const res = (await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password: "password-123" },
  })) as { body: string; statusCode: number };
  if (res.statusCode !== 200) throw new Error(`test login failed: ${res.body}`);
  return { "x-api-token": (JSON.parse(res.body) as { sessionId: string }).sessionId };
}

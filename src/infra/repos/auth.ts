import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import { UserSchema, type Role, type User } from "../../domain/user";

const KEYLEN = 64;

export function hashPassword(password: string, saltHex?: string): { hash: string; salt: string } {
  const salt = saltHex ?? randomBytes(16).toString("hex");
  const hash = scryptSync(password, Buffer.from(salt, "hex"), KEYLEN).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  try {
    const { hash } = hashPassword(password, salt);
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(expectedHash, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

interface UserRow {
  id: string;
  username: string;
  full_name: string;
  role: string;
  password_hash: string;
  password_salt: string;
  active: number;
  must_change_password: number;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
  last_login_at: string | null;
}

function toUser(row: UserRow): User {
  return UserSchema.parse({
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    active: row.active === 1,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? undefined,
  });
}

export function getUserByUsername(db: Database.Database, username: string): (User & { passwordHash: string; passwordSalt: string; failedAttempts: number; lockedUntil: string | null }) | null {
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username.trim()) as UserRow | undefined;
  if (!row) return null;
  return { ...toUser(row), passwordHash: row.password_hash, passwordSalt: row.password_salt, failedAttempts: row.failed_attempts, lockedUntil: row.locked_until };
}

export function getUserById(db: Database.Database, id: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function listUsers(db: Database.Database): User[] {
  const rows = db.prepare("SELECT * FROM users ORDER BY username").all() as UserRow[];
  return rows.map(toUser);
}

export function countActiveAdmins(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get() as { n: number }).n;
}

export function createUser(
  db: Database.Database,
  input: { username: string; fullName: string; role: Role; password: string; mustChangePassword?: boolean; createdAt: string }
): User {
  const username = input.username.trim();
  if (!username) throw new Error("username is required");
  if (input.password.length < 8) throw new Error("password must be at least 8 characters");
  const { hash, salt } = hashPassword(input.password);
  const id = randomUUID();
  try {
    db.prepare(
      "INSERT INTO users (id, username, full_name, role, password_hash, password_salt, active, must_change_password, failed_attempts, locked_until, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0, NULL, ?, NULL)"
    ).run(id, username, input.fullName.trim(), input.role, hash, salt, input.mustChangePassword ? 1 : 0, input.createdAt);
  } catch (e) {
    throw new Error(`username "${username}" already exists`);
  }
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
  return toUser(row);
}

export function setUserActive(db: Database.Database, id: string, active: boolean): boolean {
  return db.prepare("UPDATE users SET active = ? WHERE id = ?").run(active ? 1 : 0, id).changes > 0;
}

export function setUserPassword(db: Database.Database, id: string, password: string, mustChange: boolean): boolean {
  if (password.length < 8) throw new Error("password must be at least 8 characters");
  const { hash, salt } = hashPassword(password);
  return (
    db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?").run(hash, salt, mustChange ? 1 : 0, id).changes > 0
  );
}

export function recordLoginAttempt(db: Database.Database, id: string, ok: boolean, nowIso: string, lockMinutes = 10, maxAttempts = 5): void {
  if (ok) {
    db.prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?").run(nowIso, id);
    return;
  }
  const row = db.prepare("SELECT failed_attempts AS n FROM users WHERE id = ?").get(id) as { n: number } | undefined;
  const n = (row?.n ?? 0) + 1;
  if (n >= maxAttempts) {
    const until = new Date(new Date(nowIso).getTime() + lockMinutes * 60_000).toISOString();
    db.prepare("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?").run(n, until, id);
  } else {
    db.prepare("UPDATE users SET failed_attempts = ? WHERE id = ?").run(n, id);
  }
}

// ---- sessions (opaque random tickets, server-side) ----
export function createSession(db: Database.Database, userId: string, nowIso: string, hours = 12): string {
  const id = randomBytes(32).toString("hex");
  const expiresAt = new Date(new Date(nowIso).getTime() + hours * 3_600_000).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(id, userId, expiresAt, nowIso);
  return id;
}

export function getSessionUser(db: Database.Database, sessionId: string, nowIso: string): User | null {
  const row = db
    .prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ? AND u.active = 1")
    .get(sessionId, nowIso) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function deleteSession(db: Database.Database, sessionId: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function deleteUserSessions(db: Database.Database, userId: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

// ---- transition grants ----
export function grantTransition(
  db: Database.Database,
  input: { userId: string; grantedBy: string; reason: string; expiresAt: string; createdAt: string }
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresAt)) throw new Error("expiresAt must be YYYY-MM-DD");
  if (!input.reason.trim()) throw new Error("reason is required");
  const id = randomUUID();
  db.prepare("INSERT INTO transition_grants (id, user_id, granted_by, reason, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)").run(
    id, input.userId, input.grantedBy, input.reason.trim(), input.expiresAt, input.createdAt
  );
  return id;
}

export function revokeGrant(db: Database.Database, id: string, nowIso: string): boolean {
  return db.prepare("UPDATE transition_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(nowIso, id).changes > 0;
}

export function hasActiveGrant(db: Database.Database, userId: string, today: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM transition_grants WHERE user_id = ? AND revoked_at IS NULL AND expires_at >= ? LIMIT 1")
    .get(userId, today) as { ok: number } | undefined;
  return !!row;
}

export function listActiveGrants(db: Database.Database, today: string): { id: string; userId: string; expiresAt: string }[] {
  const rows = db
    .prepare("SELECT id, user_id, expires_at FROM transition_grants WHERE revoked_at IS NULL AND expires_at >= ? ORDER BY expires_at")
    .all(today) as { id: string; user_id: string; expires_at: string }[];
  return rows.map((r) => ({ id: r.id, userId: r.user_id, expiresAt: r.expires_at }));
}

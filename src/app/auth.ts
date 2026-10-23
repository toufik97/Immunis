import type Database from "better-sqlite3";
import { hasPermission, type Permission, type User } from "../domain/user";
import {
  createSession,
  createUser,
  deleteSession,
  deleteUserSessions,
  getSessionUser,
  getUserByUsername,
  recordLoginAttempt,
  verifyPassword,
  countActiveAdmins,
} from "../infra/repos/auth";
import { nowIso as nowIsoStamp, todayLocal } from "../infra/time";

export interface AuthContext {
  user: User;
  sessionId: string;
}

export function requirePermission(ctx: AuthContext, perm: Permission): void {
  if (!hasPermission(ctx.user.role, perm)) {
    throw Object.assign(new Error(`forbidden: needs ${perm}`), { status: 403 });
  }
}

export function sessionFromHeader(db: Database.Database, header: string | undefined, nowIso: string): AuthContext | null {
  if (!header) return null;
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (!token) return null;
  const user = getSessionUser(db, token, nowIso);
  return user ? { user, sessionId: token } : null;
}

export function login(
  db: Database.Database,
  username: string,
  password: string,
  opts?: { nowIso?: string; today?: string }
): { user: User; sessionId: string } {
  const nowIso = opts?.nowIso ?? nowIsoStamp();
  const clean = username.trim();
  const rec = getUserByUsername(db, clean);
  // Same message for unknown user or bad password (no user discovery).
  if (!rec || !rec.active) throw Object.assign(new Error("invalid username or password"), { status: 401 });
  if (rec.lockedUntil && rec.lockedUntil > nowIso) {
    throw Object.assign(new Error(`locked until ${rec.lockedUntil}`), { status: 423 });
  }
  if (!verifyPassword(password, rec.passwordSalt, rec.passwordHash)) {
    recordLoginAttempt(db, rec.id, false, nowIso);
    throw Object.assign(new Error("invalid username or password"), { status: 401 });
  }
  recordLoginAttempt(db, rec.id, true, nowIso);
  const sessionId = createSession(db, rec.id, nowIso, 12);
  const user: User = { ...rec };
  return { user, sessionId };
}

export function logout(db: Database.Database, sessionId: string): void {
  deleteSession(db, sessionId);
}

export function bootstrapFirstAdmin(
  db: Database.Database,
  input: { username: string; fullName: string; password: string; nowIso?: string }
): User {
  if (countActiveAdmins(db) > 0) throw Object.assign(new Error("admin already exists"), { status: 400 });
  return createUser(db, {
    username: input.username,
    fullName: input.fullName,
    role: "admin",
    password: input.password,
    mustChangePassword: true,
    createdAt: input.nowIso ?? nowIsoStamp(),
  });
}

export function todayStr(): string {
  return todayLocal();
}

export { deleteUserSessions };

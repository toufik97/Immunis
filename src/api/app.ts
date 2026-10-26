import Fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { z, ZodError } from "zod";
import type { SchedulePack } from "../infra/packs/loader";
import { evaluatePatient } from "../engine";
import { isValidDateString, parseDate } from "../engine/duration";
import { toEngineHistory } from "../app/evaluate-child";
import { findChildrenByName, getChild, listChildren } from "../infra/repos/children";
import { registerChild } from "../app/register-child";
import { listDosesByChild, listDoseDetailsByChild, listEncountersByChild } from "../infra/repos/encounters";
import { nowIso, todayLocal, centreTimeZone } from "../infra/time";
import { recordVisit, RecordGateError } from "../app/record-visit";
import {
  flagVoidEncounter,
  voidEncounter,
  reinstateEncounter,
  invalidateDose,
  revalidateDose,
  CorrectionError,
} from "../app/encounter-correction";
import { addLot, listLots, checkLotUsable, usableLotsFor } from "../infra/repos/stock";
import { appendProducts, createAppointment, deleteAppointment, findPendingByChildDateSlot, listByChild, updateAppointment } from "../infra/repos/appointments";
import { growthFor } from "../app/child-growth";
import { noShowsFor, sessionFor, agendaFor } from "../app/sessions";
import { insertOverride, listOverridesByChild, listRecentOverrides, insertAuditLog, queryAuditLog, listAuditActions } from "../infra/repos/audit";
import { countCentreDosesByProduct } from "../app/analytics";
import { exportCentre, listPendingOutbox, countPendingOutbox, ackOutbox } from "../infra/sync/sync";
import { DoseRecordSchema, ScreeningResultSchema } from "../domain/encounter";
import { SlotSchema, SchedulingRuleSchema } from "../domain/scheduling";
import { checkBooking, suggestBookingSlot } from "../app/scheduling";
import {
  listSchedulingRules,
  replaceSchedulingRules,
  getBookingHorizon,
  setBookingHorizon,
  listClosures,
  addClosure,
  deleteClosure,
  upsertAutoClosures,
} from "../infra/repos/scheduling";
import { hasPermission, type Permission, type User } from "../domain/user";
import { bootstrapFirstAdmin, login, logout, sessionFromHeader } from "../app/auth";
import {
  createUser,
  deleteUserSessions,
  getUserById,
  getUserByUsername,
  grantTransition,
  hasActiveGrant,
  listActiveGrants,
  listGrantHistory,
  listUsers,
  revokeGrant,
  setUserActive,
  setUserPassword,
  verifyPassword,
} from "../infra/repos/auth";

const ChildInput = z.object({
  familyName: z.string().min(1),
  givenName: z.string().min(1),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sex: z.enum(["M", "F"]),
  fatherName: z.string().optional(),
  motherName: z.string().optional(),
  address: z.string().optional(),
  centreId: z.string().optional(),
  firstVisitYear: z.string().regex(/^\d{4}$/).optional(),
  /** Set when the nurse confirms registration despite a duplicate warning. */
  force: z.boolean().optional(),
});

const EncounterInput = z.object({
  childId: z.string().min(1),
  /** Identity confirmation key (FR-1.2): must match the registry birthDate. */
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  screening: ScreeningResultSchema,
  screeningNote: z.string().optional(),
  weightKg: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  doses: z.array(DoseRecordSchema).default([]),
  nextAppointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Justification when waiving overridable engine warnings. Audited. */
  overrideReason: z.string().optional(),
  /** Paper-transition reason for CENTRE doses with no lot (needs an active grant). */
  transitionReason: z.string().optional(),
});

const LotInput = z.object({
  productGroupId: z.string().min(1),
  lotNumber: z.string().min(1),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coldChainOk: z.boolean(),
  qtyOnHand: z.number().int().nonnegative(),
});

const OverrideInput = z.object({
  author: z.string().min(1),
  what: z.string().min(1),
  reason: z.string().min(1),
  encounterId: z.string().optional(),
});

/** Civil-date plus N days (UTC calendar arithmetic). */
function plusDays(date: string, n: number): string {
  const t = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function isDomainError(e: unknown): boolean {  const m = e instanceof Error ? e.message : "";
  return (
    m.startsWith("child already has") ||
    m.includes("requires a lot") ||
    m.includes("not usable") ||
    m.includes("required together") ||
    m.includes("only ") && m.includes("doses") ||
    m.includes("non-VACCINATE") ||
    m.includes("must be a real YYYY-MM-DD") ||
    m.includes("is in the future")
  );
}

function sendError(reply: { code(n: number): { send(b: unknown): void } }, e: unknown): void {
  if (e instanceof ZodError) {
    reply.code(400).send({ error: "Invalid request", details: e.issues.map((i) => i.message) });
    return;
  }
  if (isDomainError(e)) {
    reply.code(400).send({ error: e instanceof Error ? e.message : "Bad request" });
    return;
  }
  throw e;
}

/** Fastify app with session login (no shared token). */
export function buildApp(db: Database.Database, pack: SchedulePack): FastifyInstance {
  const app = Fastify({ logger: false });

  const SESSION_COOKIE = "immunis-session";

  function sessionIdFrom(req: { headers: Record<string, string | string[] | undefined>; url: string }): string | undefined {
    const cookie = req.headers["cookie"];
    if (typeof cookie === "string") {
      for (const part of cookie.split(";")) {
        const [k, ...v] = part.trim().split("=");
        if (k === SESSION_COOKIE && v.length > 0) return decodeURIComponent(v.join("="));
      }
    }
    const header = req.headers["x-api-token"] ?? req.headers["authorization"];
    const raw = Array.isArray(header) ? header[0] : header;
    if (typeof raw === "string" && raw.length > 0) {
      return raw.startsWith("Bearer ") ? raw.slice(7) : raw;
    }
    return undefined;
  }

  function currentUser(req: Parameters<Parameters<FastifyInstance["addHook"]>[1]>[0]): (User & { sessionId: string }) | null {
    const ctx = sessionFromHeader(db, sessionIdFrom(req as never), nowIso());
    return ctx ? { ...ctx.user, sessionId: ctx.sessionId } : null;
  }

  function deny(reply: { code(n: number): { send(b: unknown): void } }, status: 401 | 403, message: string): void {
    reply.code(status).send({ error: message });
  }

  function need(reply: { code(n: number): { send(b: unknown): void } }, user: { role: User["role"] } | null, perm: Permission): boolean {
    if (!user) {
      deny(reply, 401, "Unauthorized: log in first");
      return false;
    }
    if (!hasPermission(user.role, perm)) {
      deny(reply, 403, `Forbidden: needs ${perm}`);
      return false;
    }
    return true;
  }

  /** One audit row per human write. Never throws: logging must not break care. */
  function log(
    me: { id: string; username: string } | null,
    username: string,
    action: string,
    details?: string,
    childId?: string
  ): void {
    try {
      insertAuditLog(db, {
        userId: me?.id ?? null,
        username,
        action,
        details,
        childId,
        createdAt: nowIso(),
      });
    } catch {
      /* audit insert failure must not break the write itself */
    }
  }

  const PUBLIC = new Set(["POST /api/auth/login", "POST /api/auth/bootstrap", "GET /api/health", "GET /api/auth/status"]);
  app.addHook("onRequest", async (req, reply) => {
    const key = `${req.method} ${(req.url as string).split("?")[0]}`;
    if (PUBLIC.has(key)) return;
    if (!(req.url as string).startsWith("/api/")) return;
    if (!sessionIdFrom(req as never)) {
      reply.code(401).send({ error: "Unauthorized: log in first" });
    }
  });
  const catalog = pack.catalog as unknown as Record<string, unknown>;
  const meta = catalog["meta"] as Record<string, unknown>;
  const packMeta = {
    packId: meta?.["pack_id"],
    version: meta?.["version"],
    status: meta?.["status"],
    clinicalApproval: meta?.["clinical_approval"],
  };

  app.get("/api/health", async () => ({ ok: true }));

  // Centre clock for the UI: zone + today + now, so the visit form and the
  // audit display never trust the device's own date around midnight.
  app.get("/api/time", async () => ({ zone: centreTimeZone(), today: todayLocal(), now: nowIso() }));

  // ---- auth (login replaces the old shared centre token) ----
  app.get("/api/auth/status", async () => {
    const users = listUsers(db);
    return { needsBootstrap: users.length === 0, userCount: users.length };
  });

  app.post("/api/auth/bootstrap", async (req, reply) => {
    try {
      const input = z
        .object({
          username: z.string().min(1),
          fullName: z.string().min(1),
          password: z.string().min(8),
        })
        .parse(req.body);
      const user = bootstrapFirstAdmin(db, input);
      log(null, input.username, "auth.bootstrap", `first admin ${input.username}`);
      reply.code(201).send({ user });
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 400) return reply.code(400).send({ error: (e as Error).message });
      sendError(reply, e);
    }
  });

  app.post("/api/auth/login", async (req, reply) => {
    try {
      const input = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
      const { user, sessionId } = login(db, input.username, input.password);
      (reply as unknown as { header(n: string, v: string): void }).header(
        "Set-Cookie",
        `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200`
      );
      log(user, user.username, "auth.login");
      return { user, sessionId };
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) {
        try {
          const body = (req.body ?? {}) as Record<string, unknown>;
          if (typeof body["username"] === "string") log(null, body["username"], "auth.login_failed");
        } catch {
          /* ignore */
        }
        return reply.code(401).send({ error: (e as Error).message });
      }
      if (status === 423) {
        try {
          const body = (req.body ?? {}) as Record<string, unknown>;
          if (typeof body["username"] === "string") log(null, body["username"], "auth.locked");
        } catch {
          /* ignore */
        }
        return reply.code(423).send({ error: (e as Error).message });
      }
      sendError(reply, e);
    }
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const me = currentUser(req as never);
    const sid = sessionIdFrom(req as never);
    if (sid) logout(db, sid);
    if (me) log(me, me.username, "auth.logout");
    (reply as unknown as { header(n: string, v: string): void }).header(
      "Set-Cookie",
      `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
    );
    return { ok: true };
  });

  app.get("/api/auth/me", async (req, reply) => {
    const me = currentUser(req as never);
    if (!me) return reply.code(401).send({ error: "Unauthorized: log in first" });
    const { sessionId: _s, ...user } = me;
    return { user };
  });

  app.post("/api/auth/change-password", async (req, reply) => {
    try {
      const me = currentUser(req as never);
      if (!me) return reply.code(401).send({ error: "Unauthorized: log in first" });
      const input = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) }).parse(req.body);
      const rec = getUserByUsername(db, me.username);
      if (!rec || !verifyPassword(input.currentPassword, rec.passwordSalt, rec.passwordHash)) {
        return reply.code(401).send({ error: "current password is wrong" });
      }
      setUserPassword(db, me.id, input.newPassword, false);
      log(me, me.username, "auth.password_change");
      return { ok: true };
    } catch (e) {
      sendError(reply, e);
    }
  });

  // ---- users (admin only; first admin comes from /bootstrap) ----
  app.get("/api/users", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "user.manage")) return;
    return listUsers(db);
  });

  app.post("/api/users", async (req, reply) => {
    try {
      const me = currentUser(req as never);
      if (!need(reply as never, me, "user.manage")) return;
      const input = z
        .object({
          username: z.string().min(1),
          fullName: z.string().min(1),
          role: z.enum(["nurse", "admin", "reader"]),
          password: z.string().min(8),
          mustChangePassword: z.boolean().default(true),
        })
        .parse(req.body);
      const user = createUser(db, { ...input, createdAt: nowIso() });
      log(me!, me!.username, "user.create", `${input.username} (${input.role})`);
      reply.code(201).send({ user });
    } catch (e) {
      sendError(reply, e);
    }
  });

  app.patch("/api/users/:id", async (req, reply) => {
    try {
      const me = currentUser(req as never);
      if (!need(reply as never, me, "user.manage")) return;
      const id = (req.params as Record<string, string>).id;
      const target = getUserById(db, id);
      if (!target) {
        reply.code(404).send({ error: "User not found" });
        return;
      }
      const input = z
        .object({
          active: z.boolean().optional(),
          role: z.enum(["nurse", "admin", "reader"]).optional(),
          password: z.string().min(8).optional(),
        })
        .parse(req.body);
      if (input.active === false || input.role !== undefined) {
        const nextRole = input.role ?? target.role;
        const nextActive = input.active ?? target.active;
        // Never leave zero active admins.
        const admins = listUsers(db).filter((u) => u.role === "admin" && u.active);
        const stillAdmin = nextRole === "admin" && nextActive;
        if (target.role === "admin" && target.active && !stillAdmin && admins.length <= 1) {
          reply.code(400).send({ error: "cannot remove the last active admin" });
          return;
        }
      }
      if (input.active !== undefined) {
        setUserActive(db, id, input.active);
        log(me!, me!.username, input.active ? "user.enable" : "user.disable", target.username);
      }
      if (input.role !== undefined) {
        db.prepare("UPDATE users SET role = ? WHERE id = ?").run(input.role, id);
        log(me!, me!.username, "user.role_change", `${target.username} → ${input.role}`);
      }
      if (input.password !== undefined) {
        setUserPassword(db, id, input.password, true);
        log(me!, me!.username, "user.password_reset", target.username);
      }
      if (input.active === false) deleteUserSessions(db, id);
      return { ok: true };
    } catch (e) {
      sendError(reply, e);
    }
  });

  // ---- transition grants (admin grants, admin+reader view history) ----
  app.get("/api/transition-grants", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "audit.view")) return;
    const q = req.query as Record<string, string>;
    if (q.history === "1") return listGrantHistory(db);
    return listActiveGrants(db, todayLocal());
  });

  app.post("/api/transition-grants", async (req, reply) => {
    try {
      const me = currentUser(req as never);
      if (!need(reply as never, me, "transition.grant")) return;
      const input = z
        .object({ userId: z.string().min(1), reason: z.string().min(1), expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
        .parse(req.body);
      if (!getUserById(db, input.userId)) {
        reply.code(404).send({ error: "User not found" });
        return;
      }
      const id = grantTransition(db, { ...input, grantedBy: me!.id, createdAt: nowIso() });
      const target = getUserById(db, input.userId);
      log(me!, me!.username, "transition.grant", `${target?.username ?? input.userId}: ${input.reason} until ${input.expiresAt}`);
      reply.code(201).send({ id });
    } catch (e) {
      sendError(reply, e);
    }
  });

  app.post("/api/transition-grants/:id/revoke", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "transition.grant")) return;
    if (!revokeGrant(db, (req.params as Record<string, string>).id, nowIso())) {
      reply.code(404).send({ error: "Grant not found" });
      return;
    }
    log(me!, me!.username, "transition.revoke", (req.params as Record<string, string>).id);
    return { ok: true };
  });

  app.get("/api/pack", async (req, reply) => {
    const me = currentUser(req as never);
    if (!me) return reply.code(401).send({ error: "Unauthorized: log in first" });
    const groups = (catalog["product_groups"] as { id: string; label_fr?: string; satisfies_antigens?: string[] }[]) ?? [];
    const counters = (pack.counters.counters ?? []).map((c) => ({
      id: c.id,
      label_fr: c.label_fr,
      counts_product_groups: c.counts_product_groups ?? [],
    }));
    return {
      country: meta?.["country"],
      ...packMeta,
      productGroups: groups.map((g) => ({
        id: g.id,
        label_fr: g.label_fr,
        satisfies_antigens: g.satisfies_antigens ?? [],
      })),
      counters,
      programs: Object.values(pack.programs).map((p) => ({
        id: p.program?.id,
        label_fr: (p.program as Record<string, unknown>)?.["label_fr"],
        antigen_targets: p.program?.antigen_targets ?? [],
        counter: p.program?.counter,
      })),
    };
  });

  // ---- registry ----
  app.post("/api/children", async (req, reply) => {
    try {
      const me = currentUser(req as never);
      if (!need(reply as never, me, "child.create")) return;
      const input = ChildInput.parse(req.body);
      const result = registerChild(db, input);
      if (result.status === "duplicate") {
        reply
          .code(409)
          .send({ error: "Possible duplicate: a child with this name and birth date exists", duplicates: result.duplicates });
        return;
      }
      reply.code(201).send(result.child);
      log(me!, me!.username, "child.register", `${result.child.givenName} ${result.child.familyName}`, result.child.id);
    } catch (e) {
      sendError(reply, e);
    }
  });

  app.get("/api/children", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "child.read")) return;
    const q = ((req.query as Record<string, string>).q ?? "").trim();
    if (!q) return listChildren(db);
    return findChildrenByName(db, q);
  });

  app.get("/api/children/:id", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "child.read")) return;
    const child = getChild(db, (req.params as Record<string, string>).id);
    if (!child) {
      reply.code(404).send({ error: "Child not found" });
      return;
    }
    return child;
  });

  app.get("/api/children/:id/doses", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "child.read")) return;
    // Voided visits excluded (phantom records never reach the engine or ledger counts).
    return listDoseDetailsByChild(db, (req.params as Record<string, string>).id);
  });

  // ---- encounter ledger (per-visit status for the correction ticket UI) ----
  app.get("/api/children/:id/encounters", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "child.read")) return;
    if (!getChild(db, (req.params as Record<string, string>).id)) {
      reply.code(404).send({ error: "Child not found" });
      return;
    }
    return listEncountersByChild(db, (req.params as Record<string, string>).id);
  });

  app.get("/api/children/:id/appointments", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "child.read")) return;
    if (!getChild(db, (req.params as Record<string, string>).id)) {
      reply.code(404).send({ error: "Child not found" });
      return;
    }
    return listByChild(db, (req.params as Record<string, string>).id);
  });

  app.get("/api/children/:id/growth", async (req, reply) => {    const me = currentUser(req as never);
    if (!need(reply as never, me, "child.read")) return;
    const child = getChild(db, (req.params as Record<string, string>).id);
    if (!child) {
      reply.code(404).send({ error: "Child not found" });
      return;
    }
    if (!child.sex) {
      reply.code(400).send({ error: "Sex is required for growth scores" });
      return;
    }
    return growthFor(db, { childId: child.id, birthDate: child.birthDate, sex: child.sex });
  });

  // ---- visits ----
  app.post("/api/encounters", async (req, reply) => {
    try {
      const me = currentUser(req as never);
      if (!me) return reply.code(401).send({ error: "Unauthorized: log in first" });
      const input = EncounterInput.parse(req.body);
      const child = getChild(db, input.childId);
      if (!child) {
        reply.code(404).send({ error: "Child not found" });
        return;
      }
      if (child.birthDate !== input.birthDate) {
        reply.code(403).send({ error: "Identity confirmation failed: birthDate does not match" });
        return;
      }
      if (input.screening !== "VACCINATE" && input.doses.length > 0) {
        reply.code(400).send({ error: "non-VACCINATE screening cannot record doses" });
        return;
      }
      try {
        const hasCentre = input.doses.some((d) => d.origin === "CENTRE");
        if (!need(reply as never, me, hasCentre ? "visit.record_centre" : "visit.record_external")) return;
        const transitionAllowed =
          hasPermission(me.role, "visit.record_transition") && hasActiveGrant(db, me.id, todayLocal());
        const doses = input.doses.map((d) => ({ ...d, recordedBy: me.username }));
        const { encounter, waived } = recordVisit(db, pack, child.birthDate, listDosesByChild(db, child.id), {
          ...input,
          doses,
          transition: { allowed: transitionAllowed, source: "paper-transition", reason: input.transitionReason ?? "" },
        });
        const given = doses.filter((d) => d.origin === "CENTRE").map((d) => d.productGroupId);
        const waivedCodes = [...new Set(waived.map((w) => w.code))];
        const overrideSuffix = waived.length > 0 ? ` [override ${waivedCodes.join("+")}: ${input.overrideReason?.trim() ?? ""}]` : "";
        log(me, me.username, "encounter.record", `${child.givenName} ${child.familyName} visit ${input.date}${given.length ? ` (${given.join(", ")})` : ""}${doses.some((d) => d.origin === "CENTRE" && !d.lotId) ? " [transition]" : ""}${overrideSuffix}`, child.id);
        reply.code(201).send(encounter);
      } catch (e) {
        if (e instanceof RecordGateError) {
          reply.code(e.status).send({ error: e.message, issues: e.issues });
          return;
        }
        throw e;
      }
    } catch (e) {
      sendError(reply, e);
    }
  });

  // ---- correction tickets (Scenario B: phantom void + override invalidate) ----
  function getChildByEncounter(db: Database.Database, encounterId: string): string | null {
    const row = db.prepare("SELECT child_id FROM encounters WHERE id = ?").get(encounterId) as
      | { child_id: string }
      | undefined;
    return row?.child_id ?? null;
  }

  app.post("/api/encounters/:id/flag-void", async (req, reply) => {
    const me = currentUser(req as never);
    if (!me) return reply.code(401).send({ error: "Unauthorized: log in first" });
    try {
      const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);
      const id = (req.params as Record<string, string>).id;
      flagVoidEncounter(db, id, { username: me.username, role: me.role }, reason);
      log(me, me.username, "encounter.flag_void", `visit ${id}: ${reason}`, getChildByEncounter(db, id) ?? undefined);
      return { ok: true };
    } catch (e) {
      if (e instanceof CorrectionError) return reply.code(e.status).send({ error: e.message });
      sendError(reply, e);
    }
  });

  app.post("/api/encounters/:id/void", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "visit.void")) return;
    try {
      const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);
      const id = (req.params as Record<string, string>).id;
      const childId = getChildByEncounter(db, id);
      voidEncounter(db, id, me!.username, reason);
      log(me!, me!.username, "encounter.void", `visit ${id} voided: ${reason}`, childId ?? undefined);
      return { ok: true };
    } catch (e) {
      if (e instanceof CorrectionError) return reply.code(e.status).send({ error: e.message });
      sendError(reply, e);
    }
  });

  app.post("/api/encounters/:id/reinstate", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "visit.void")) return;
    try {
      const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);
      const id = (req.params as Record<string, string>).id;
      const childId = getChildByEncounter(db, id);
      reinstateEncounter(db, id, me!.username, reason);
      log(me!, me!.username, "encounter.reinstate", `visit ${id} reinstated: ${reason}`, childId ?? undefined);
      return { ok: true };
    } catch (e) {
      if (e instanceof CorrectionError) return reply.code(e.status).send({ error: e.message });
      sendError(reply, e);
    }
  });

  app.post("/api/doses/:id/invalidate", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "visit.void")) return;
    try {
      const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);
      const id = (req.params as Record<string, string>).id;
      invalidateDose(db, id, me!.username, reason);
      log(me!, me!.username, "dose.invalidate", `dose ${id}: ${reason}`);
      return { ok: true };
    } catch (e) {
      if (e instanceof CorrectionError) return reply.code(e.status).send({ error: e.message });
      sendError(reply, e);
    }
  });

  app.post("/api/doses/:id/revalidate", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "visit.void")) return;
    try {
      const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);
      const id = (req.params as Record<string, string>).id;
      revalidateDose(db, id, me!.username, reason);
      log(me!, me!.username, "dose.revalidate", `dose ${id}: ${reason}`);
      return { ok: true };
    } catch (e) {
      if (e instanceof CorrectionError) return reply.code(e.status).send({ error: e.message });
      sendError(reply, e);
    }
  });

  // Admin review queue: flagged visits + voided visits + invalidated doses.
  app.get("/api/review-queue", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "visit.void")) return;
    const flagged = db
      .prepare(
        `SELECT e.*, c.given_name || ' ' || c.family_name AS child_name FROM encounters e
         JOIN children c ON c.id = e.child_id
         WHERE e.void_requested_by IS NOT NULL AND e.voided_at IS NULL ORDER BY e.void_requested_at DESC`
      )
      .all() as Record<string, unknown>[];
    const voided = db
      .prepare(
        `SELECT e.*, c.given_name || ' ' || c.family_name AS child_name FROM encounters e
         JOIN children c ON c.id = e.child_id
         WHERE e.voided_at IS NOT NULL ORDER BY e.voided_at DESC LIMIT 100`
      )
      .all() as Record<string, unknown>[];
    const invalidated = db
      .prepare(
        `SELECT d.*, c.given_name || ' ' || c.family_name AS child_name FROM doses d
         JOIN children c ON c.id = d.child_id
         WHERE d.invalidated_at IS NOT NULL ORDER BY d.invalidated_at DESC LIMIT 100`
      )
      .all() as Record<string, unknown>[];
    return { flagged, voided, invalidated };
  });

  // ---- stock ----
  app.post("/api/lots", async (req, reply) => {
    try {
      const me = currentUser(req as never);
      if (!need(reply as never, me, "stock.add")) return;
      const lot = addLot(db, LotInput.parse(req.body));
      log(me!, me!.username, "stock.lot_add", `${lot.productGroupId} ${lot.lotNumber} exp ${lot.expiryDate} x${lot.qtyOnHand}`);
      reply.code(201).send(lot);
    } catch (e) {
      sendError(reply, e);
    }
  });

  app.get("/api/lots", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "stock.read")) return;
    const q = req.query as Record<string, string>;
    const product = q.product || undefined;
    if (q.usableOn !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(q.usableOn)) {
        reply.code(400).send({ error: "usableOn must be YYYY-MM-DD" });
        return;
      }
      return usableLotsFor(db, product, q.usableOn);
    }
    return listLots(db, product);
  });

  app.get("/api/lots/:id/usable", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "stock.read")) return;
    const { id } = req.params as Record<string, string>;
    const on = (req.query as Record<string, string>).on ?? todayLocal();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) {
      reply.code(400).send({ error: "on must be YYYY-MM-DD" });
      return;
    }
    return { status: checkLotUsable(db, id, on) };
  });

  // ---- sessions, appointments, no-shows ----
  app.get("/api/sessions", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "session.view")) return;
    const date = (req.query as Record<string, string>).date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      reply.code(400).send({ error: "date is required (YYYY-MM-DD)" });
      return;
    }
    return sessionFor(db, date);
  });

  // Pending-appointment load per day (agenda): no more trial-and-error dates.
  app.get("/api/sessions/agenda", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "session.view")) return;
    const q = req.query as Record<string, string>;
    const today = todayLocal();
    const from = q.from ?? today;
    const to = q.to ?? plusDays(today, 180);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      reply.code(400).send({ error: "from/to must be YYYY-MM-DD" });
      return;
    }
    if (from > to) {
      reply.code(400).send({ error: "from must not be after to" });
      return;
    }
    return agendaFor(db, from, to);
  });

  app.post("/api/appointments", async (req, reply) => {
    try {
      const me = currentUser(req as never);
      if (!need(reply as never, me, "appointment.manage")) return;
      const input = z
        .object({
          childId: z.string().min(1),
          dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          expectedProducts: z.array(z.string().min(1)).default([]),
          slot: SlotSchema.default("AM"),
          overrideReason: z.string().min(1).optional(),
          /** Engine-recommended date this booking follows: horizon anchor. */
          engineDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .parse(req.body);
      if (!getChild(db, input.childId)) {
        reply.code(404).send({ error: "Child not found" });
        return;
      }
      // Operational scheduling rules constrain the booked date/slot, never the clinical plan.
      const issues = checkBooking(db, {
        dueDate: input.dueDate,
        slot: input.slot,
        expectedProducts: input.expectedProducts,
        referenceDate: input.engineDate ?? todayLocal(),
      });
      if (issues.length > 0 && !input.overrideReason) {
        return reply.code(409).send({ error: "Booking breaks scheduling rules", issues });
      }
      const existing = findPendingByChildDateSlot(db, input.childId, input.dueDate, input.slot);
      if (existing) {
        const merged = appendProducts(db, existing.id, input.expectedProducts);
        if (issues.length > 0) {
          insertOverride(db, {
            childId: input.childId,
            author: me!.username,
            what: `appointment.scheduling: ${issues.map((i) => i.code).join(", ")}`,
            reason: input.overrideReason!,
            createdAt: nowIso(),
          });
          log(me!, me!.username, "appointment.override", `${input.dueDate} ${input.slot}: ${input.overrideReason}`, input.childId);
        }
        log(me!, me!.username, "appointment.merge", `${input.childId} due ${input.dueDate} ${input.slot} merged`, input.childId);
        return { ...(merged ?? existing), merged: true };
      }
      const appt = createAppointment(db, input);
      if (issues.length > 0) {
        insertOverride(db, {
          childId: input.childId,
          author: me!.username,
          what: `appointment.scheduling: ${issues.map((i) => i.code).join(", ")}`,
          reason: input.overrideReason!,
          createdAt: nowIso(),
        });
        log(me!, me!.username, "appointment.override", `${input.dueDate} ${input.slot}: ${input.overrideReason}`, input.childId);
      } else {
        log(me!, me!.username, "appointment.create", `${input.childId} due ${input.dueDate}`, input.childId);
      }
      reply.code(201).send(appt);
    } catch (e) {
      sendError(reply, e);
    }
  });

  // ---- scheduling (workflow settings: operational rules, nurse+admin write) ----
  app.get("/api/scheduling", async (req, reply) => {
    const me = currentUser(req as never);
    if (!me) return reply.code(401).send({ error: "Unauthorized: log in first" });
    return { rules: listSchedulingRules(db), horizonDays: getBookingHorizon(db) };
  });

  app.put("/api/scheduling", async (req, reply) => {
    try {
      const me = currentUser(req as never);
      if (!need(reply as never, me, "appointment.manage")) return;
      const input = z
        .object({
          rules: z.array(SchedulingRuleSchema),
          horizonDays: z.number().int().min(1).max(365).nullable(),
        })
        .parse(req.body);
      const rules = replaceSchedulingRules(db, input.rules);
      const horizonDays = setBookingHorizon(db, input.horizonDays);
      log(me!, me!.username, "scheduling.update", `${rules.length} rules, horizon ${horizonDays ?? "none"}`);
      return { rules, horizonDays };
    } catch (e) {
      sendError(reply, e);
    }
  });

  // Booking suggestion: first open day/slot at or after a date (nurse picks freely; gate still validates).
  app.get("/api/scheduling/suggest", async (req, reply) => {
    const me = currentUser(req as never);
    if (!me) return reply.code(401).send({ error: "Unauthorized: log in first" });
    const q = req.query as Record<string, string>;
    const from = q.from ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return reply.code(400).send({ error: "Bad from date" });
    const products = (q.products ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const slot = q.slot === "PM" ? ("PM" as const) : ("AM" as const);
    return (
      suggestBookingSlot(db, { fromDate: from, expectedProducts: products, preferSlot: slot }) ?? null
    );
  });

  app.get("/api/closures", async (req, reply) => {
    const me = currentUser(req as never);
    if (!me) return reply.code(401).send({ error: "Unauthorized: log in first" });
    const year = (req.query as Record<string, string>).year;
    return listClosures(db, year && /^\d{4}$/.test(year) ? year : undefined);
  });

  app.post("/api/closures", async (req, reply) => {
    try {
      const me = currentUser(req as never);
      if (!need(reply as never, me, "appointment.manage")) return;
      const input = z
        .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), label: z.string().min(1).max(120) })
        .parse(req.body);
      const row = addClosure(db, input);
      log(me!, me!.username, "closure.add", `${row.date} ${row.label}`);
      reply.code(201).send(row);
    } catch (e) {
      sendError(reply, e);
    }
  });

  app.delete("/api/closures/:date", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "appointment.manage")) return;
    const date = (req.params as Record<string, string>).date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return reply.code(400).send({ error: "Bad date" });
    if (!deleteClosure(db, date)) return reply.code(404).send({ error: "Closure not found" });
    log(me!, me!.username, "closure.delete", date);
    return { ok: true };
  });

  // Pull national + religious holidays for a year (Nager.Date v3, pinned).
  // Cached locally: the pull is a refresh button, the table is the truth offline.
  app.post("/api/closures/pull", async (req, reply) => {
    try {
      const me = currentUser(req as never);
      if (!need(reply as never, me, "appointment.manage")) return;
      const year = z.object({ year: z.number().int().min(2000).max(2100) }).parse(req.body).year;
      const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/MA`);
      if (!res.ok) return reply.code(502).send({ error: `Holiday service answered ${res.status}` });
      const days = (await res.json()) as { date?: unknown; localName?: unknown; name?: unknown }[];
      const holidays = days
        .filter((d) => typeof d.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
        .map((d) => ({ date: d.date as string, label: typeof d.localName === "string" && d.localName ? d.localName : String(d.name ?? d.date) }));
      const added = upsertAutoClosures(db, holidays);
      log(me!, me!.username, "closure.pull", `${year}: ${added} new`);
      return { added, holidays: listClosures(db, String(year)) };
    } catch (e) {
      sendError(reply, e);
    }
  });

  // Past appointments are history (kept/missed is written by visit recording, never by hand):
  // only future pending rows move. Horizon is anchored on the current due date so
  // shifting inside the original plan never false-triggers; pushing past it needs a reason.
  app.put("/api/appointments/:id", async (req, reply) => {
    try {
      const me = currentUser(req as never);
      if (!need(reply as never, me, "appointment.manage")) return;
      const input = z
        .object({
          dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          slot: SlotSchema.default("AM"),
          expectedProducts: z.array(z.string().min(1)).default([]),
          overrideReason: z.string().min(1).optional(),
        })
        .parse(req.body);
      const id = (req.params as Record<string, string>).id;
      const row = db.prepare("SELECT child_id, due_date, kept FROM appointments WHERE id = ?").get(id) as
        | { child_id: string; due_date: string; kept: number | null }
        | undefined;
      if (!row) {
        reply.code(404).send({ error: "Appointment not found" });
        return;
      }
      if (row.kept !== null) {
        reply.code(400).send({ error: "Resolved appointments cannot be edited" });
        return;
      }
      const today = todayLocal();
      if (row.due_date < today) {
        reply.code(400).send({ error: "Past appointments cannot be edited" });
        return;
      }
      if (input.dueDate < today) {
        reply.code(400).send({ error: "New date must not be in the past" });
        return;
      }
      const issues = checkBooking(db, {
        dueDate: input.dueDate,
        slot: input.slot,
        expectedProducts: input.expectedProducts,
        referenceDate: row.due_date,
        excludeAppointmentId: id,
      });
      if (issues.length > 0 && !input.overrideReason) {
        return reply.code(409).send({ error: "Booking breaks scheduling rules", issues });
      }
      const sibling = findPendingByChildDateSlot(db, row.child_id, input.dueDate, input.slot);
      if (sibling && sibling.id !== id) {
        // Reschedule lands on an existing pending row: merge products into it, drop the moved row.
        const merged = appendProducts(db, sibling.id, input.expectedProducts);
        deleteAppointment(db, id);
        if (issues.length > 0) {
          insertOverride(db, {
            childId: row.child_id,
            author: me!.username,
            what: `appointment.reschedule: ${issues.map((i) => i.code).join(", ")}`,
            reason: input.overrideReason!,
            createdAt: nowIso(),
          });
          log(me!, me!.username, "appointment.override", `${row.due_date} → ${input.dueDate} ${input.slot}: ${input.overrideReason}`, row.child_id);
        }
        log(me!, me!.username, "appointment.merge", `${row.child_id} ${row.due_date} → ${input.dueDate} ${input.slot} merged`, row.child_id);
        return { ...(merged ?? sibling), merged: true };
      }
      const updated = updateAppointment(db, id, input);
      if (!updated) {
        reply.code(404).send({ error: "Appointment not found" });
        return;
      }
      if (issues.length > 0) {
        insertOverride(db, {
          childId: row.child_id,
          author: me!.username,
          what: `appointment.reschedule: ${issues.map((i) => i.code).join(", ")}`,
          reason: input.overrideReason!,
          createdAt: nowIso(),
        });
        log(me!, me!.username, "appointment.override", `${row.due_date} → ${input.dueDate} ${input.slot}: ${input.overrideReason}`, row.child_id);
      } else {
        log(me!, me!.username, "appointment.reschedule", `${row.child_id} ${row.due_date} → ${input.dueDate}`, row.child_id);
      }
      return updated;
    } catch (e) {
      sendError(reply, e);
    }
  });

  // Upcoming pending rows can be deleted with a reason (audited); history never leaves the ledger.
  app.delete("/api/appointments/:id", async (req, reply) => {
    try {
      const me = currentUser(req as never);
      if (!need(reply as never, me, "appointment.manage")) return;
      const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body ?? {});
      const id = (req.params as Record<string, string>).id;
      const row = db.prepare("SELECT child_id, due_date, kept FROM appointments WHERE id = ?").get(id) as
        | { child_id: string; due_date: string; kept: number | null }
        | undefined;
      if (!row) {
        reply.code(404).send({ error: "Appointment not found" });
        return;
      }
      if (row.kept !== null) {
        reply.code(400).send({ error: "Resolved appointments cannot be deleted" });
        return;
      }
      if (row.due_date < todayLocal()) {
        reply.code(400).send({ error: "Past appointments cannot be deleted" });
        return;
      }
      insertOverride(db, {
        childId: row.child_id,
        author: me!.username,
        what: "appointment.delete",
        reason,
        createdAt: nowIso(),
      });
      deleteAppointment(db, id);
      log(me!, me!.username, "appointment.delete", `${row.due_date}: ${reason}`, row.child_id);
      return { ok: true };
    } catch (e) {
      sendError(reply, e);
    }
  });

  app.get("/api/no-shows", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "session.view")) return;
    const asOf = (req.query as Record<string, string>).asOf;
    if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      reply.code(400).send({ error: "asOf is required (YYYY-MM-DD)" });
      return;
    }
    return noShowsFor(db, asOf);
  });

  // ---- overrides ----
  app.post("/api/children/:id/overrides", async (req, reply) => {
    try {
      const me = currentUser(req as never);
      if (!need(reply as never, me, "visit.record_centre")) return;
      const childId = (req.params as Record<string, string>).id;
      if (!getChild(db, childId)) {
        reply.code(404).send({ error: "Child not found" });
        return;
      }
      const input = OverrideInput.parse(req.body);
      if (
        input.encounterId &&
        !(db.prepare("SELECT 1 FROM encounters WHERE id = ?").get(input.encounterId) as unknown)
      ) {
        reply.code(400).send({ error: "Encounter not found" });
        return;
      }
      reply.code(201).send(
        insertOverride(db, {
          childId,
          author: me!.username,
          what: input.what,
          reason: input.reason,
          encounterId: input.encounterId,
          createdAt: nowIso(),
        })
      );
    } catch (e) {
      sendError(reply, e);
    }
  });

  app.get("/api/children/:id/overrides", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "child.read")) return;
    return listOverridesByChild(db, (req.params as Record<string, string>).id);
  });

  // ---- audit trail (admin + reader) ----
  app.get("/api/overrides", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "audit.view")) return;
    const q = req.query as Record<string, string>;
    const limit = q.limit ? Number(q.limit) : 200;
    return listRecentOverrides(db, Number.isFinite(limit) ? limit : 200);
  });

  app.get("/api/audit", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "audit.view")) return;
    const q = req.query as Record<string, string>;
    const limit = q.limit ? Number(q.limit) : 50;
    const safeLimit = Number.isFinite(limit) ? limit : 50;
    const page = Math.max(Number(q.page ?? 0) || 0, 0);
    return queryAuditLog(db, {
      q: q.q,
      action: q.action,
      username: q.username,
      from: q.from,
      to: q.to,
      sort: q.sort === "username" || q.sort === "action" ? q.sort : "created_at",
      order: q.order === "asc" ? "asc" : "desc",
      limit: safeLimit,
      offset: page * safeLimit,
    });
  });

  app.get("/api/audit/actions", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "audit.view")) return;
    return listAuditActions(db);
  });

  // ---- analytics (CENTRE only, transition rows excluded) ----
  app.get("/api/analytics/doses", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "session.view")) return;
    return countCentreDosesByProduct(db);
  });

  // ---- backup & sync ----
  app.get("/api/backup", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "backup.export")) return;
    log(me!, me!.username, "backup.export");
    return exportCentre(db);
  });

  app.get("/api/outbox", async (req, reply) => {
    const me = currentUser(req as never);
    if (!me) return reply.code(401).send({ error: "Unauthorized: log in first" });
    return listPendingOutbox(db);
  });

  app.get("/api/outbox/count", async (req, reply) => {
    const me = currentUser(req as never);
    if (!me) return reply.code(401).send({ error: "Unauthorized: log in first" });
    return { pending: countPendingOutbox(db) };
  });

  app.post("/api/outbox/:id/ack", async (req, reply) => {
    try {
      const me = currentUser(req as never);
      if (!need(reply as never, me, "backup.export")) return;
      const { syncedAt } = z
        .object({ syncedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/) })
        .parse(req.body);
      if (!ackOutbox(db, (req.params as Record<string, string>).id, syncedAt)) {
        reply.code(404).send({ error: "Outbox entry not found" });
        return;
      }
      return { ok: true };
    } catch (e) {
      sendError(reply, e);
    }
  });

  // ---- clinical evaluation (registry history or raw playground history) ----
  app.post("/api/evaluate", async (req, reply) => {
    const me = currentUser(req as never);
    if (!need(reply as never, me, "session.view")) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const evaluationDate = body["evaluationDate"];
      if (typeof evaluationDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(evaluationDate)) {
        reply.code(400).send({ error: "evaluationDate is required (YYYY-MM-DD)" });
        return;
      }
      if (evaluationDate > todayLocal()) {
        reply.code(400).send({ error: `evaluationDate ${evaluationDate} is in the future` });
        return;
      }
      const projection = body["projection"] === "full" ? "full" : "next";
      let availability = body["availability"] as
        | { policy?: "TRANSITION" | "CONTINUITY_FIRST" | "STOCK_DRIVEN"; products?: string[] }
        | undefined;

      let birthDate: string;
      let history: { administeredOn: string; productGroupId: string; overridden?: boolean }[];
      if (typeof body["childId"] === "string") {
        const child = getChild(db, body["childId"]);
        if (!child) {
          reply.code(404).send({ error: "Child not found" });
          return;
        }
        birthDate = child.birthDate;
        history = toEngineHistory(listDosesByChild(db, child.id), pack);
        // Stock-connected plans: the centre's usable lots inform the
        // recommendation instead of a blind policy assumption. Empty stock
        // stays unconnected (the warning is true: nothing usable informs it).
        if (!availability?.products) {
          const usable = usableLotsFor(db, undefined, evaluationDate);
          if (usable.length > 0) {
            availability = {
              policy: availability?.policy ?? "TRANSITION",
              products: [...new Set(usable.map((l) => l.productGroupId))],
            };
          }
        }
      } else {
        if (typeof body["birthDate"] !== "string") {
          reply.code(400).send({ error: "birthDate or childId is required" });
          return;
        }
        if (!isValidDateString(body["birthDate"])) {
          reply.code(400).send({ error: "birthDate must be a real YYYY-MM-DD calendar date" });
          return;
        }
        birthDate = body["birthDate"];
        const raw = Array.isArray(body["history"]) ? (body["history"] as unknown[]) : [];
        const errors: string[] = [];
        history = [];
        raw.forEach((row: unknown, i: number) => {
          const r = row as Record<string, unknown>;
          if (typeof r?.["administeredOn"] !== "string" || !isValidDateString(r["administeredOn"])) {
            errors.push(`history[${i}].administeredOn is required (YYYY-MM-DD)`);
            return;
          }
          if (typeof r?.["productGroupId"] !== "string" || r["productGroupId"] === "") {
            errors.push(`history[${i}].productGroupId is required`);
            return;
          }
          if ((r["administeredOn"] as string) > (evaluationDate as string)) {
            errors.push(`history[${i}] date ${r["administeredOn"]} is after evaluationDate`);
            return;
          }
          history.push({
            administeredOn: r["administeredOn"] as string,
            productGroupId: r["productGroupId"] as string,
            overridden: r["overridden"] === true,
          });
        });
        if (errors.length) {
          reply.code(400).send({ error: "Invalid history", details: errors });
          return;
        }
      }

      const result = evaluatePatient(
        { birthDate },
        history,
        pack,
        parseDate(evaluationDate),
        { projection, availability }
      );
      const { evaluationDate: _evalDate, ...rest } = result;
      reply.send({ pack: packMeta, evaluationDate, ...rest });
    } catch (e) {
      sendError(reply, e);
    }
  });

  return app;
}

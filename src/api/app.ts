import Fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { z, ZodError } from "zod";
import type { SchedulePack } from "../infra/packs/loader";
import { evaluatePatient } from "../engine";
import { isValidDateString, parseDate } from "../engine/duration";
import { toEngineHistory } from "../app/evaluate-child";
import { findChildrenByName, getChild, listChildren } from "../infra/repos/children";
import { registerChild } from "../app/register-child";
import { listDosesByChild } from "../infra/repos/encounters";
import { nowIso, todayLocal } from "../infra/time";
import { recordVisit, RecordGateError } from "../app/record-visit";
import { addLot, listLots, checkLotUsable, usableLotsFor } from "../infra/repos/stock";
import { createAppointment, markAppointment } from "../infra/repos/appointments";
import { noShowsFor, sessionFor, agendaFor } from "../app/sessions";
import { insertOverride, listOverridesByChild, listRecentOverrides } from "../infra/repos/audit";
import { countCentreDosesByProduct } from "../app/analytics";
import { exportCentre, listPendingOutbox, countPendingOutbox, ackOutbox } from "../infra/sync/sync";
import { DoseRecordSchema, ScreeningResultSchema } from "../domain/encounter";
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
      return { user, sessionId };
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) return reply.code(401).send({ error: (e as Error).message });
      if (status === 423) return reply.code(423).send({ error: (e as Error).message });
      sendError(reply, e);
    }
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const sid = sessionIdFrom(req as never);
    if (sid) logout(db, sid);
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
      if (input.active !== undefined) setUserActive(db, id, input.active);
      if (input.role !== undefined) {
        db.prepare("UPDATE users SET role = ? WHERE id = ?").run(input.role, id);
      }
      if (input.password !== undefined) setUserPassword(db, id, input.password, true);
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
    return listDosesByChild(db, (req.params as Record<string, string>).id);
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
        const { encounter } = recordVisit(db, pack, child.birthDate, listDosesByChild(db, child.id), {
          ...input,
          doses,
          transition: { allowed: transitionAllowed, source: "paper-transition", reason: input.transitionReason ?? "" },
        });
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

  // ---- stock ----
  app.post("/api/lots", async (req, reply) => {
    try {
      const me = currentUser(req as never);
      if (!need(reply as never, me, "stock.add")) return;
      reply.code(201).send(addLot(db, LotInput.parse(req.body)));
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
        })
        .parse(req.body);
      if (!getChild(db, input.childId)) {
        reply.code(404).send({ error: "Child not found" });
        return;
      }
      reply.code(201).send(createAppointment(db, input));
    } catch (e) {
      sendError(reply, e);
    }
  });

  app.patch("/api/appointments/:id", async (req, reply) => {
    try {
      const me = currentUser(req as never);
      if (!need(reply as never, me, "appointment.manage")) return;
      const { kept } = z.object({ kept: z.boolean() }).parse(req.body);
      if (!markAppointment(db, (req.params as Record<string, string>).id, kept)) {
        reply.code(404).send({ error: "Appointment not found" });
        return;
      }
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

import Fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { timingSafeEqual } from "node:crypto";
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
import { insertOverride, listOverridesByChild } from "../infra/repos/audit";
import { countCentreDosesByProduct } from "../app/analytics";
import { exportCentre, listPendingOutbox, ackOutbox } from "../infra/sync/sync";
import { DoseRecordSchema, ScreeningResultSchema } from "../domain/encounter";

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

/** Fastify app over an opened DB (per-centre file in prod, :memory: in tests). */
export function buildApp(
  db: Database.Database,
  pack: SchedulePack,
  opts?: { apiToken?: string }
): FastifyInstance {
  const app = Fastify({ logger: false });
  // Optional shared centre token (IMMUNIS_TOKEN): when set, every /api route
  // except the liveness probe requires it as `x-api-token`.
  const apiToken = opts?.apiToken ?? process.env.IMMUNIS_TOKEN ?? "";
  if (apiToken) {
    app.addHook("onRequest", async (req, reply) => {
      const path = req.url.split("?")[0];
      if (!path.startsWith("/api/") || path === "/api/health") return;
      const got = req.headers["x-api-token"];
      const ok =
        typeof got === "string" &&
        got.length === apiToken.length &&
        timingSafeEqual(Buffer.from(got), Buffer.from(apiToken));
      if (!ok) reply.code(401).send({ error: "Unauthorized: set the centre token" });
    });
  }
  const catalog = pack.catalog as unknown as Record<string, unknown>;
  const meta = catalog["meta"] as Record<string, unknown>;
  const packMeta = {
    packId: meta?.["pack_id"],
    version: meta?.["version"],
    status: meta?.["status"],
    clinicalApproval: meta?.["clinical_approval"],
  };

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/pack", async () => {
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

  app.get("/api/children", async (req) => {
    const q = ((req.query as Record<string, string>).q ?? "").trim();
    if (!q) return listChildren(db);
    return findChildrenByName(db, q);
  });

  app.get("/api/children/:id", async (req, reply) => {
    const child = getChild(db, (req.params as Record<string, string>).id);
    if (!child) {
      reply.code(404).send({ error: "Child not found" });
      return;
    }
    return child;
  });

  app.get("/api/children/:id/doses", async (req) => {
    return listDosesByChild(db, (req.params as Record<string, string>).id);
  });

  // ---- visits ----
  app.post("/api/encounters", async (req, reply) => {
    try {
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
        const { encounter } = recordVisit(db, pack, child.birthDate, listDosesByChild(db, child.id), input);
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
      reply.code(201).send(addLot(db, LotInput.parse(req.body)));
    } catch (e) {
      sendError(reply, e);
    }
  });

  app.get("/api/lots", async (req, reply) => {
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
    const date = (req.query as Record<string, string>).date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      reply.code(400).send({ error: "date is required (YYYY-MM-DD)" });
      return;
    }
    return sessionFor(db, date);
  });

  // Pending-appointment load per day (agenda): no more trial-and-error dates.
  app.get("/api/sessions/agenda", async (req, reply) => {
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
          author: input.author,
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

  app.get("/api/children/:id/overrides", async (req) => {
    return listOverridesByChild(db, (req.params as Record<string, string>).id);
  });

  // ---- analytics (CENTRE only) ----
  app.get("/api/analytics/doses", async () => countCentreDosesByProduct(db));

  // ---- backup & sync ----
  app.get("/api/backup", async () => exportCentre(db));

  app.get("/api/outbox", async () => listPendingOutbox(db));

  app.post("/api/outbox/:id/ack", async (req, reply) => {
    try {
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
      const availability = body["availability"] as
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

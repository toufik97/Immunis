import Fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { z, ZodError } from "zod";
import type { SchedulePack } from "../infra/packs/loader";
import { evaluatePatient } from "../engine";
import { parseDate } from "../engine/duration";
import { toEngineHistory } from "../app/evaluate-child";
import { createChild, findChildrenByName, getChild, allocateLocalId, findPossibleDuplicates } from "../infra/repos/children";
import { recordEncounter, listDosesByChild, todayLocal } from "../infra/repos/encounters";
import { addLot, listLots, checkLotUsable } from "../infra/repos/stock";
import { createAppointment, listDue, markAppointment, listNoShows } from "../infra/repos/appointments";
import { insertOverride, listOverridesByChild } from "../infra/repos/audit";
import { countCentreDosesByProduct } from "../app/analytics";
import { exportCentre, listPendingOutbox, ackOutbox } from "../infra/sync/sync";
import { DoseRecordSchema, ScreeningResultSchema } from "../domain/encounter";

const ChildInput = z.object({
  familyName: z.string().min(1),
  givenName: z.string().min(1),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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

function isDomainError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : "";
  return (
    m.startsWith("child already has") ||
    m.includes("requires a lot") ||
    m.includes("not usable") ||
    m.includes("only ") && m.includes("doses") ||
    m.includes("non-VACCINATE")
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
export function buildApp(db: Database.Database, pack: SchedulePack): FastifyInstance {
  const app = Fastify({ logger: false });
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
      if (!input.force) {
        const duplicates = findPossibleDuplicates(db, input.familyName, input.givenName, input.birthDate);
        if (duplicates.length > 0) {
          reply.code(409).send({ error: "Possible duplicate: a child with this name and birth date exists", duplicates });
          return;
        }
      }
      const child = createChild(db, input);
      if (input.centreId && input.firstVisitYear) {
        allocateLocalId(db, child.id, input.centreId, input.firstVisitYear);
        const full = getChild(db, child.id);
        reply.code(201).send(full);
        return;
      }
      reply.code(201).send({ ...child, localIds: [] });
    } catch (e) {
      sendError(reply, e);
    }
  });

  app.get("/api/children", async (req) => {
    const q = ((req.query as Record<string, string>).q ?? "").trim();
    if (!q) return [];
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
      const encounter = recordEncounter(db, input);
      reply.code(201).send(encounter);
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

  app.get("/api/lots", async (req) => {
    const product = (req.query as Record<string, string>).product;
    return listLots(db, product || undefined);
  });

  app.get("/api/lots/:id/usable", async (req) => {
    const { id } = req.params as Record<string, string>;
    const on = (req.query as Record<string, string>).on ?? new Date().toISOString().slice(0, 10);
    return { status: checkLotUsable(db, id, on) };
  });

  // ---- sessions, appointments, no-shows ----
  app.get("/api/sessions", async (req, reply) => {
    const date = (req.query as Record<string, string>).date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      reply.code(400).send({ error: "date is required (YYYY-MM-DD)" });
      return;
    }
    const expected = listDue(db, date);
    const dosesByProduct: Record<string, number> = {};
    for (const a of expected) {
      for (const p of a.expectedProducts) dosesByProduct[p] = (dosesByProduct[p] ?? 0) + 1;
    }
    return { date, expected, counters: { children: expected.length, dosesByProduct } };
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
      reply.code(201).send(createAppointment(db, input));
    } catch (e) {
      sendError(reply, e);
    }
  });

  app.patch("/api/appointments/:id", async (req, reply) => {
    try {
      const { kept } = z.object({ kept: z.boolean() }).parse(req.body);
      markAppointment(db, (req.params as Record<string, string>).id, kept);
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
    return listNoShows(db, asOf);
  });

  // ---- overrides ----
  app.post("/api/children/:id/overrides", async (req, reply) => {
    try {
      const input = OverrideInput.parse(req.body);
      reply.code(201).send(
        insertOverride(db, {
          childId: (req.params as Record<string, string>).id,
          author: input.author,
          what: input.what,
          reason: input.reason,
          encounterId: input.encounterId,
          createdAt: new Date().toISOString(),
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
        .object({ syncedAt: z.string().min(1) })
        .parse(req.body);
      ackOutbox(db, (req.params as Record<string, string>).id, syncedAt);
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
        history = toEngineHistory(listDosesByChild(db, child.id));
      } else {
        if (typeof body["birthDate"] !== "string") {
          reply.code(400).send({ error: "birthDate or childId is required" });
          return;
        }
        birthDate = body["birthDate"];
        const raw = Array.isArray(body["history"]) ? (body["history"] as unknown[]) : [];
        const errors: string[] = [];
        history = [];
        raw.forEach((row: unknown, i: number) => {
          const r = row as Record<string, unknown>;
          if (typeof r?.["administeredOn"] !== "string") {
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

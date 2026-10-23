import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { SchedulePack } from "../infra/packs/loader";
import { evaluatePatient } from "../engine";
import { parseDate } from "../engine/duration";
import { toStructured } from "../engine/warnings";
import { canonicalProductId, nextExpectedProducts, toGatedEngineHistory } from "./evaluate-child";
import { checkSpacing } from "./spacing-guard";
import type { DoseRecord, Encounter } from "../domain/encounter";
import { EncounterSchema } from "../domain/encounter";
import {
  storeEncounter,
  validateEncounterDates,
  type NewEncounter,
  type PersistOptions,
} from "../infra/repos/encounters";
import { nowIso as nowIsoStamp, todayLocal } from "../infra/time";
import { insertOverride } from "../infra/repos/audit";

export interface GateIssue {
  doseIndex: number;
  productGroupId: string;
  administeredOn: string;
  code: string;
  message: string;
  overridable: boolean;
}

/** Thrown when the engine cross-check refuses a recording. */
export class RecordGateError extends Error {
  status: 400 | 422;
  issues: GateIssue[];
  constructor(status: 400 | 422, issues: GateIssue[]) {
    super(issues.map((i) => i.code).join(", ") || "recording blocked by engine check");
    this.status = status;
    this.issues = issues;
  }
}

export interface RecordVisitInput extends NewEncounter {
  /** Required when any new dose waives an overridable warning. Audited. */
  overrideReason?: string;
  /** Paper-transition: CENTRE doses with no lot. Server sets this from the grant, never the client. */
  transition?: { allowed: boolean; source: string; reason: string };
}

/** One row per (dose, code): PENTA trips DTP/HB/Hib counters with the same code. */
function dedupeIssues(issues: GateIssue[]): GateIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.doseIndex}|${i.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Clinical gate around visit recording (the engine as gatekeeper, not display).
 * Only CENTRE doses are gated — they are administered here, now, under our
 * responsibility. EXTERNAL/CAMPAIGN rows are transcribed history; the engine
 * still flags them at evaluation time but never blocks their recording.
 *
 * Single clinical seam: gate + store + Override audit commit in one
 * transaction, so a waived dose never persists without its audit row and a
 * lot failure never leaves a half-written visit. Low-level `recordEncounter`
 * stays for non-clinical persistence tests; production writes go here.
 */
export function recordVisit(
  db: Database.Database,
  pack: SchedulePack,
  childBirthDate: string,
  prior: DoseRecord[],
  input: RecordVisitInput,
  opts?: PersistOptions
): { encounter: Encounter; waived: GateIssue[] } {
  const today = opts?.today ?? todayLocal();
  const nowIso = opts?.nowIso ?? nowIsoStamp();
  // Client-supplied transition flags are ignored: only a server-checked grant may set them.
  const parsed = EncounterSchema.parse({
    childId: input.childId,
    date: input.date,
    screening: input.screening,
    screeningNote: input.screeningNote,
    weightKg: input.weightKg,
    heightCm: input.heightCm,
    doses: (input.doses ?? []).map((d) => ({ ...d, transition: false, source: undefined })),
    nextAppointmentDate: input.nextAppointmentDate,
    id: randomUUID(),
  });
  validateEncounterDates(parsed, today);
  // Real care happens today: a visit with CENTRE doses must be dated today.
  // Only a paper-transition grant (old paper moved as CENTRE) may use past
  // dates. EXTERNAL-only transcription keeps its own past dates.
  const hasCentre = parsed.doses.some((d) => d.origin === "CENTRE");
  if (hasCentre && parsed.date !== today && !input.transition?.allowed) {
    throw new RecordGateError(400, [
      {
        doseIndex: -1,
        productGroupId: "",
        administeredOn: parsed.date,
        code: "CENTRE_VISIT_MUST_BE_TODAY",
        message: "CENTRE visits must be recorded for today — paper-transition with a grant for past dates",
        overridable: false,
      },
    ]);
  }
  if (parsed.screening !== "VACCINATE" && parsed.doses.length > 0) {
    throw new RecordGateError(400, [
      {
        doseIndex: -1,
        productGroupId: "",
        administeredOn: parsed.date,
        code: "SCREENING_BLOCKS_DOSES",
        message: "non-VACCINATE screening cannot record doses",
        overridable: false,
      },
    ]);
  }
  const doses = parsed.doses;
  const canon = (id: string) => canonicalProductId(pack, id);

  // Unknown products on CENTRE doses are data errors (engine would only warn softly).
  // Aliases count as known: VITA_100K → VITA.
  const known = new Set((pack.catalog.product_groups ?? []).flatMap((g) => [g.id, ...(g.aliases ?? [])]));
  for (const [i, d] of doses.entries()) {
    if (d.origin === "CENTRE" && !known.has(d.productGroupId)) {
      throw new RecordGateError(400, [
        {
          doseIndex: i,
          productGroupId: d.productGroupId,
          administeredOn: d.administeredOn,
          code: "UNKNOWN_PRODUCT",
          message: `unknown product "${d.productGroupId}"`,
          overridable: false,
        },
      ]);
    }
  }

  // Same product + same date twice is never legitimate care.
  const seen = new Map<string, number>();
  for (const [i, d] of doses.entries()) {
    const key = `${canon(d.productGroupId)}|${d.administeredOn}`;
    const first = seen.get(key);
    if (first !== undefined) {
      throw new RecordGateError(400, [
        {
          doseIndex: i,
          productGroupId: d.productGroupId,
          administeredOn: d.administeredOn,
          code: "DUPLICATE_RECORDED",
          message: `duplicate of dose ${first + 1} in the same visit`,
          overridable: false,
        },
      ]);
    }
    seen.set(key, i);
  }
  for (const [i, d] of doses.entries()) {
    if (prior.some((p) => canon(p.productGroupId) === canon(d.productGroupId) && p.administeredOn === d.administeredOn)) {
      throw new RecordGateError(400, [
        {
          doseIndex: i,
          productGroupId: d.productGroupId,
          administeredOn: d.administeredOn,
          code: "DUPLICATE_RECORDED",
          message: `already recorded for this child`,
          overridable: false,
        },
      ]);
    }
  }

  // Paper transition: CENTRE with no lot, only with an active grant + reason.
  // After unknown-product and duplicate checks so those keep their errors.
  const transitionLots = parsed.doses.filter((d) => d.origin === "CENTRE" && !d.lotId);
  if (transitionLots.length > 0) {
    if (!input.transition?.allowed || !input.transition.reason.trim()) {
      throw new RecordGateError(400, transitionLots.map((d) => ({
        doseIndex: parsed.doses.indexOf(d),
        productGroupId: d.productGroupId,
        administeredOn: d.administeredOn,
        code: "LOT_REQUIRED",
        message: "CENTRE dose requires a lot (FR-4.3) — or an active paper-transition grant with reason",
        overridable: false,
      })));
    }
    for (const d of transitionLots) {
      d.transition = true;
      d.source = input.transition.source;
    }
  }

  // Same-day care: a CENTRE dose with no lot is paper transition (checked
  // above); a CENTRE dose with a lot must be given today, not back-dated.
  // Only the transition pass may record older CENTRE doses.
  for (const [i, d] of parsed.doses.entries()) {
    if (d.origin === "CENTRE" && !d.transition && d.administeredOn !== parsed.date) {
      throw new RecordGateError(400, [
        {
          doseIndex: i,
          productGroupId: d.productGroupId,
          administeredOn: d.administeredOn,
          code: "CENTRE_SAME_DAY_ONLY",
          message: "CENTRE doses must be recorded the same day — paper-transition with a grant for older doses",
          overridable: false,
        },
      ]);
    }
  }

  // Spacing rules (e.g. PrimoVax 15d off DTP) live in the same rule book
  // the planner uses, so plan-conformant recordings pass by construction.
  // Only new doses are blamed; history already happened.
  const spacingIssues: GateIssue[] = checkSpacing(
    prior,
    doses.map((dose, index) => ({ dose, index })).filter((x) => x.dose.origin === "CENTRE"),
    pack
  ).map((s) => ({
    doseIndex: s.doseIndex,
    productGroupId: s.productGroupId,
    administeredOn: s.administeredOn,
    code: s.code,
    message: s.message,
    overridable: true,
  }));

  // Engine cross-check on history + new doses, overrides stripped to find issues.
  const engineHistory = toGatedEngineHistory(prior, doses, pack);
  const evaluationDate = parsed.date;
  const result = evaluatePatient(
    { birthDate: childBirthDate },
    engineHistory,
    pack,
    parseDate(evaluationDate)
  );

  const invalidEntries = Object.values(result.doseValidations).flatMap((v) =>
    (v.doses ?? []).filter((e) => !e.valid)
  );
  const issues: GateIssue[] = [];
  doses.forEach((d, i) => {
    if (d.origin !== "CENTRE") return;
    for (const e of invalidEntries) {
      if (e.administeredOn === d.administeredOn && canon(e.productGroupId) === canon(d.productGroupId)) {
        for (const raw of [...e.reasons, ...e.warnings]) {
          const w = toStructured(raw);
          if (w.severity === "blocking") {
            issues.push({
              doseIndex: i,
              productGroupId: d.productGroupId,
              administeredOn: d.administeredOn,
              code: w.code,
              message: w.message_en,
              overridable: w.overridable,
            });
          }
        }
      }
    }
  });

  const hard = dedupeIssues(issues.filter((i) => !i.overridable));
  if (hard.length > 0) throw new RecordGateError(400, hard);
  const soft = dedupeIssues([...issues.filter((i) => i.overridable), ...spacingIssues]);
  const waived = soft.filter((s) => doses[s.doseIndex].overridden);
  const unwaived = soft.filter((s) => !doses[s.doseIndex].overridden);
  if (unwaived.length > 0 || (soft.length > 0 && !input.overrideReason?.trim())) {
    throw new RecordGateError(422, soft.length > 0 ? soft : unwaived);
  }

  const expectedProducts = nextExpectedProducts(result, parsed.date);

  // One audit row per waived dose (not per counter: PENTA trips DTP/HB/Hib together).
  const waivedByDose = new Map<number, GateIssue[]>();
  for (const w of waived) {
    waivedByDose.set(w.doseIndex, [...(waivedByDose.get(w.doseIndex) ?? []), w]);
  }

  // Atomic commit: visit + stock + appointment + outbox + audit, or nothing.
  const encounter = db.transaction((): Encounter => {
    const stored = storeEncounter(db, parsed, expectedProducts, { nowIso });
    for (const [doseIndex, ws] of waivedByDose) {
      const d = doses[doseIndex];
      insertOverride(db, {
        childId: parsed.childId,
        encounterId: stored.id,
        author: d.recordedBy,
        what: `override ${ws.map((w) => w.code).join("+")} for ${d.productGroupId} on ${d.administeredOn}`,
        reason: input.overrideReason!.trim(),
        createdAt: nowIso,
      });
    }
    // Paper transition is audited per dose (who moved paper into CENTRE without lot).
    if (input.transition?.allowed) {
      parsed.doses.forEach((d) => {
        if (!d.transition) return;
        insertOverride(db, {
          childId: parsed.childId,
          encounterId: stored.id,
          author: d.recordedBy,
          what: `transition ${d.productGroupId} on ${d.administeredOn} as CENTRE without lot`,
          reason: input.transition!.reason.trim(),
          createdAt: nowIso,
        });
      });
    }
    return stored;
  })();
  return { encounter, waived };
}

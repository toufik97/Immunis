import type Database from "better-sqlite3";
import type { SchedulePack } from "../infra/packs/loader";
import { evaluatePatient } from "../engine";
import { parseDate } from "../engine/duration";
import { toStructured } from "../engine/warnings";
import type { ImmunizationRecord } from "../types";
import { toEngineHistory } from "./evaluate-child";
import type { DoseRecord, Encounter } from "../domain/encounter";
import { recordEncounter, type NewEncounter } from "../infra/repos/encounters";
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
}

function canonicalProducts(pack: SchedulePack): Map<string, string> {
  const map = new Map<string, string>();
  for (const g of pack.catalog.product_groups ?? []) {
    map.set(g.id, g.id);
    for (const alias of g.aliases ?? []) map.set(alias, g.id);
  }
  return map;
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
 */
export function recordVisit(
  db: Database.Database,
  pack: SchedulePack,
  childBirthDate: string,
  prior: DoseRecord[],
  input: RecordVisitInput
): { encounter: Encounter; waived: GateIssue[] } {
  const doses = input.doses ?? [];
  const canonical = canonicalProducts(pack);
  const canon = (id: string) => canonical.get(id) ?? id;

  // Unknown products on CENTRE doses are data errors (engine would only warn softly).
  for (const [i, d] of doses.entries()) {
    if (d.origin === "CENTRE" && !canonical.has(d.productGroupId)) {
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

  // Engine cross-check on history + new doses, overrides stripped to find issues.
  const gated = doses.filter((d) => d.origin === "CENTRE" || d.origin === "EXTERNAL");
  const engineHistory: ImmunizationRecord[] = [
    ...toEngineHistory(prior),
    ...gated.map((d) => ({
      administeredOn: d.administeredOn,
      productGroupId: canon(d.productGroupId),
      overridden: false,
    })),
  ];
  const evaluationDate = input.date;
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
  const soft = dedupeIssues(issues.filter((i) => i.overridable));
  const waived = soft.filter((s) => doses[s.doseIndex].overridden);
  const unwaived = soft.filter((s) => !doses[s.doseIndex].overridden);
  if (unwaived.length > 0 || (soft.length > 0 && !input.overrideReason?.trim())) {
    throw new RecordGateError(422, soft.length > 0 ? soft : unwaived);
  }

  const encounter = recordEncounter(db, input);

  // One audit row per waived dose (not per counter: PENTA trips DTP/HB/Hib together).
  const waivedByDose = new Map<number, GateIssue[]>();
  for (const w of waived) {
    waivedByDose.set(w.doseIndex, [...(waivedByDose.get(w.doseIndex) ?? []), w]);
  }
  for (const [doseIndex, ws] of waivedByDose) {
    const d = doses[doseIndex];
    insertOverride(db, {
      childId: input.childId,
      encounterId: encounter.id,
      author: d.recordedBy,
      what: `override ${ws.map((w) => w.code).join("+")} for ${d.productGroupId} on ${d.administeredOn}`,
      reason: input.overrideReason!.trim(),
      createdAt: new Date().toISOString(),
    });
  }
  return { encounter, waived };
}

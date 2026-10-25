import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { isStockCounted } from "../domain/dose-origin";
import { getDose, getEncounter } from "../infra/repos/encounters";
import { consumeLot } from "../infra/repos/stock";
import { insertOverride } from "../infra/repos/audit";
import { nowIso as nowIsoStamp } from "../infra/time";

/** Thrown for bad correction transitions (maps to 4xx in the API layer). */
export class CorrectionError extends Error {
  status: 400 | 403 | 404 | 409 | 422;
  constructor(status: 400 | 403 | 404 | 409 | 422, message: string) {
    super(message);
    this.status = status;
  }
}

export interface CorrectionActor {
  username: string;
  role: "nurse" | "admin" | "reader";
}

function needReason(reason: string): string {
  const r = reason.trim();
  if (!r) throw new CorrectionError(400, "a reason is required");
  return r;
}

function outbox(db: Database.Database, kind: string, payload: Record<string, unknown>, stamp: string): void {
  db.prepare("INSERT INTO outbox (id, kind, payload, created_at, synced_at) VALUES (?, ?, ?, ?, NULL)").run(
    randomUUID(),
    kind,
    JSON.stringify(payload),
    stamp
  );
}

/**
 * Flag an encounter as a suspected phantom (recording error, nothing injected).
 * Only the recorder (every dose's recorded_by matches) or an admin may flag.
 * Non-destructive: sets the ticket fields, nothing else moves.
 */
export function flagVoidEncounter(
  db: Database.Database,
  encounterId: string,
  actor: CorrectionActor,
  reason: string,
  opts?: { nowIso?: string }
): void {
  const r = needReason(reason);
  const nowIso = opts?.nowIso ?? nowIsoStamp();
  const enc = getEncounter(db, encounterId);
  if (!enc) throw new CorrectionError(404, "Encounter not found");
  if (enc.voidedAt) throw new CorrectionError(409, "encounter is already voided");
  if (enc.voidRequestedBy) throw new CorrectionError(409, "encounter is already flagged");
  if (actor.role !== "admin") {
    const owners = db
      .prepare("SELECT DISTINCT recorded_by AS by FROM doses WHERE encounter_id = ?")
      .all(encounterId) as { by: string }[];
    if (owners.length === 0 || !owners.every((o) => o.by === actor.username)) {
      throw new CorrectionError(403, "only the nurse who recorded this visit (or an admin) may flag it");
    }
  }
  db.prepare("UPDATE encounters SET void_requested_by = ?, void_requested_at = ?, void_request_reason = ? WHERE id = ?").run(
    actor.username,
    nowIso,
    r,
    encounterId
  );
  outbox(db, "encounter.flag_void", { encounterId, childId: enc.childId, reason: r }, nowIso);
}

/**
 * Void a phantom encounter (admin only). The visit stays visible but is excluded
 * from engine/planning/analytics; consumed stock is restored (vial never used).
 */
export function voidEncounter(
  db: Database.Database,
  encounterId: string,
  admin: string,
  reason: string,
  opts?: { nowIso?: string }
): void {
  const r = needReason(reason);
  const nowIso = opts?.nowIso ?? nowIsoStamp();
  const enc = getEncounter(db, encounterId);
  if (!enc) throw new CorrectionError(404, "Encounter not found");
  if (enc.voidedAt) throw new CorrectionError(409, "encounter is already voided");
  db.transaction(() => {
    const doses = db.prepare("SELECT * FROM doses WHERE encounter_id = ?").all(encounterId) as {
      product_group_id: string;
      administered_on: string;
      origin: string;
      lot_id: string | null;
      transition: number;
    }[];
    for (const d of doses) {
      if (isStockCounted(d.origin as "CENTRE" | "EXTERNAL" | "CAMPAIGN", d.transition === 1) && d.lot_id) {
        db.prepare("UPDATE lots SET qty_on_hand = qty_on_hand + 1 WHERE id = ?").run(d.lot_id);
      }
    }
    db.prepare(
      "UPDATE encounters SET voided_at = ?, voided_by = ?, void_reason = ?, approved_by = ?, approved_role = ?, approved_at = ? WHERE id = ? AND voided_at IS NULL"
    ).run(nowIso, admin, r, admin, "admin", nowIso, encounterId);
    const products = [...new Set(doses.map((d) => d.product_group_id))].join("+") || "visit";
    insertOverride(db, {
      childId: enc.childId,
      encounterId,
      author: admin,
      what: `void ${products} on ${enc.date} (phantom, nothing injected)`,
      reason: r,
      createdAt: nowIso,
    });
    outbox(db, "encounter.voided", { encounterId, childId: enc.childId, reason: r }, nowIso);
  })();
}

/**
 * Reinstate a voided encounter (admin only): back into engine/planning, stock
 * re-consumed. Fails loudly when the lot is gone, empty, expired or cold-chain
 * broken — the admin must fix stock first, never silently desync.
 */
export function reinstateEncounter(
  db: Database.Database,
  encounterId: string,
  admin: string,
  reason: string,
  opts?: { nowIso?: string }
): void {
  const r = needReason(reason);
  const nowIso = opts?.nowIso ?? nowIsoStamp();
  const enc = getEncounter(db, encounterId);
  if (!enc) throw new CorrectionError(404, "Encounter not found");
  if (!enc.voidedAt) throw new CorrectionError(409, "encounter is not voided");
  db.transaction(() => {
    const doses = db.prepare("SELECT * FROM doses WHERE encounter_id = ?").all(encounterId) as {
      product_group_id: string;
      administered_on: string;
      origin: string;
      lot_id: string | null;
      transition: number;
    }[];
    for (const d of doses) {
      if (isStockCounted(d.origin as "CENTRE" | "EXTERNAL" | "CAMPAIGN", d.transition === 1)) {
        if (!d.lot_id) throw new CorrectionError(422, "cannot reinstate: CENTRE dose has no lot");
        consumeLot(db, d.lot_id, 1, enc.date);
      }
    }
    db.prepare(
      "UPDATE encounters SET voided_at = NULL, voided_by = NULL, void_reason = NULL, reinstated_at = ?, reinstated_by = ?, reinstated_reason = ? WHERE id = ?"
    ).run(nowIso, admin, r, encounterId);
    insertOverride(db, {
      childId: enc.childId,
      encounterId,
      author: admin,
      what: `reinstate visit on ${enc.date} (void undone)`,
      reason: r,
      createdAt: nowIso,
    });
    outbox(db, "encounter.reinstated", { encounterId, childId: enc.childId, reason: r }, nowIso);
  })();
}

/**
 * Invalidate a nurse override (admin only): the dose was given but the waiver is
 * clinically rejected — the engine treats it as invalid again. No stock move
 * (the vial was really used). Only overridden, non-voided doses are eligible.
 */
export function invalidateDose(
  db: Database.Database,
  doseId: string,
  admin: string,
  reason: string,
  opts?: { nowIso?: string }
): void {
  const r = needReason(reason);
  const nowIso = opts?.nowIso ?? nowIsoStamp();
  const d = getDose(db, doseId);
  if (!d) throw new CorrectionError(404, "Dose not found");
  if (!d.overridden) throw new CorrectionError(409, "dose has no override to invalidate");
  const enc = getEncounter(db, d.encounter_id);
  if (enc?.voidedAt) throw new CorrectionError(409, "encounter is voided: reinstate it instead");
  db.transaction(() => {
    db.prepare("UPDATE doses SET overridden = 0, invalidated_at = ?, invalidated_by = ?, invalidated_reason = ? WHERE id = ?").run(
      nowIso,
      admin,
      r,
      doseId
    );
    insertOverride(db, {
      childId: d.child_id,
      encounterId: d.encounter_id,
      author: admin,
      what: `invalidate override ${d.product_group_id} on ${d.administered_on} (dose was given, waiver rejected)`,
      reason: r,
      createdAt: nowIso,
    });
    outbox(db, "dose.invalidated", { doseId, encounterId: d.encounter_id, childId: d.child_id, reason: r }, nowIso);
  })();
}

/** Undo an invalidation (admin only): the waiver counts again. No stock move. */
export function revalidateDose(
  db: Database.Database,
  doseId: string,
  admin: string,
  reason: string,
  opts?: { nowIso?: string }
): void {
  const r = needReason(reason);
  const nowIso = opts?.nowIso ?? nowIsoStamp();
  const d = getDose(db, doseId);
  if (!d) throw new CorrectionError(404, "Dose not found");
  if (!d.invalidated_at) throw new CorrectionError(409, "dose is not invalidated");
  db.transaction(() => {
    db.prepare("UPDATE doses SET overridden = 1, invalidated_at = NULL, invalidated_by = NULL, invalidated_reason = NULL WHERE id = ?").run(doseId);
    insertOverride(db, {
      childId: d.child_id,
      encounterId: d.encounter_id,
      author: admin,
      what: `re-validate override ${d.product_group_id} on ${d.administered_on} (invalidation undone)`,
      reason: r,
      createdAt: nowIso,
    });
    outbox(db, "dose.revalidated", { doseId, encounterId: d.encounter_id, childId: d.child_id, reason: r }, nowIso);
  })();
}

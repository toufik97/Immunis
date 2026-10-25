import { describe, it, expect } from "vitest";
import { openTestDb, adminHeaders } from "./db-helper";
import { createChild } from "../../src/infra/repos/children";
import { addLot, getLot } from "../../src/infra/repos/stock";
import { listDosesByChild, listEncountersByChild } from "../../src/infra/repos/encounters";
import { recordVisit } from "../../src/app/record-visit";
import {
  flagVoidEncounter,
  voidEncounter,
  reinstateEncounter,
  invalidateDose,
  revalidateDose,
  CorrectionError,
} from "../../src/app/encounter-correction";
import { listOverridesByChild } from "../../src/infra/repos/audit";
import { toEngineHistory } from "../../src/app/evaluate-child";
import { loadSchedulePack } from "../../src/infra/packs/loader";
import { buildApp } from "../../src/api/app";
import { createUser } from "../../src/infra/repos/auth";

const pack = loadSchedulePack("MA");

const dose = (productGroupId: string, administeredOn: string, origin: "CENTRE" | "EXTERNAL" = "CENTRE") => ({
  productGroupId,
  administeredOn,
  origin,
  overridden: false,
  recordedBy: "nurse1",
});

function setup() {
  const db = openTestDb();
  const child = createChild(db, { familyName: "A", givenName: "A", birthDate: "2026-01-01", sex: "M" });
  const penta = addLot(db, { productGroupId: "PENTA", lotNumber: "L1", expiryDate: "2027-12-01", coldChainOk: true, qtyOnHand: 5 });
  const pcv = addLot(db, { productGroupId: "PCV_PRIMOVAX", lotNumber: "L2", expiryDate: "2027-12-01", coldChainOk: true, qtyOnHand: 5 });
  return { db, child, lots: { penta, pcv } };
}

function recordCentre(db: ReturnType<typeof openTestDb>, childId: string, product: string, lotId: string, extra = {}) {
  const child = db.prepare("SELECT birth_date FROM children WHERE id = ?").get(childId) as { birth_date: string };
  return recordVisit(db, pack, child.birth_date, listDosesByChild(db, childId), {
    childId,
    date: "2026-03-01",
    screening: "VACCINATE",
    doses: [{ ...dose(product, "2026-03-01"), lotId, ...extra }],
  }, { today: "2026-03-01" });
}

describe("correction tickets (phantom void + override invalidate)", () => {
  it("flags only by the recorder or an admin", () => {
    const { db, child, lots } = setup();
    const { encounter } = recordCentre(db, child.id, "PENTA", lots.penta.id);
    // Stranger nurse cannot flag someone else's work.
    expect(() => flagVoidEncounter(db, encounter.id, { username: "nurse2", role: "nurse" }, "looks wrong")).toThrow(CorrectionError);
    // Recorder can.
    flagVoidEncounter(db, encounter.id, { username: "nurse1", role: "nurse" }, "wrong child");
    const [enc] = listEncountersByChild(db, child.id);
    expect(enc.voidRequestedBy).toBe("nurse1");
    expect(enc.voidRequestReason).toBe("wrong child");
    // Double flag is rejected.
    expect(() => flagVoidEncounter(db, encounter.id, { username: "admin1", role: "admin" }, "again")).toThrow(CorrectionError);
    db.close();
  });

  it("voids phantom visits: excluded from engine, stock restored, audited", () => {
    const { db, child, lots } = setup();
    const { encounter } = recordCentre(db, child.id, "PENTA", lots.penta.id);
    expect(getLot(db, lots.penta.id)?.qtyOnHand).toBe(4);
    flagVoidEncounter(db, encounter.id, { username: "nurse1", role: "nurse" }, "nothing injected, typo");
    voidEncounter(db, encounter.id, "admin1", "confirmed phantom");
    // Excluded from clinical reads.
    expect(listDosesByChild(db, child.id)).toHaveLength(0);
    expect(toEngineHistory(listDosesByChild(db, child.id), pack)).toHaveLength(0);
    // Stock restored (vial never used).
    expect(getLot(db, lots.penta.id)?.qtyOnHand).toBe(5);
    // Audit trail kept: waiver-style override row + voided state.
    expect(listOverridesByChild(db, child.id).some((o) => o.what.startsWith("void PENTA"))).toBe(true);
    const [enc] = listEncountersByChild(db, child.id);
    expect(enc.voidedBy).toBe("admin1");
    // Double void rejected.
    expect(() => voidEncounter(db, encounter.id, "admin1", "again")).toThrow(CorrectionError);
    db.close();
  });

  it("reinstates a void: doses count again, stock re-consumed", () => {
    const { db, child, lots } = setup();
    const { encounter } = recordCentre(db, child.id, "PENTA", lots.penta.id);
    voidEncounter(db, encounter.id, "admin1", "phantom?");
    reinstateEncounter(db, encounter.id, "admin1", "shot was real after all");
    expect(listDosesByChild(db, child.id)).toHaveLength(1);
    expect(getLot(db, lots.penta.id)?.qtyOnHand).toBe(4);
    // Reinstate of a non-voided visit is rejected.
    expect(() => reinstateEncounter(db, encounter.id, "admin1", "again")).toThrow(CorrectionError);
    db.close();
  });

  it("invalidate/revalidate round-trip keeps stock untouched", () => {
    const { db, child, lots } = setup();
    recordCentre(db, child.id, "PENTA", lots.penta.id);
    const child2 = db.prepare("SELECT birth_date FROM children WHERE id = ?").get(child.id) as { birth_date: string };
    const { encounter } = recordVisit(db, pack, child2.birth_date, listDosesByChild(db, child.id), {
      childId: child.id,
      date: "2026-03-01",
      screening: "VACCINATE",
      doses: [{ ...dose("PCV_PRIMOVAX", "2026-03-01"), overridden: true, lotId: lots.pcv.id }],
      overrideReason: "single trip family",
    }, { today: "2026-03-01" });
    const doseRow = db.prepare("SELECT * FROM doses WHERE encounter_id = ? AND product_group_id = 'PCV_PRIMOVAX'").get(encounter.id) as { id: string; overridden: number };
    expect(doseRow.overridden).toBe(1);
    // Non-overridden dose cannot be invalidated.
    const pentaRow = db.prepare("SELECT * FROM doses WHERE product_group_id = 'PENTA'").get() as { id: string };
    expect(() => invalidateDose(db, pentaRow.id, "admin1", "nope")).toThrow(CorrectionError);
    invalidateDose(db, doseRow.id, "admin1", "waiver clinically rejected");
    const after = db.prepare("SELECT * FROM doses WHERE id = ?").get(doseRow.id) as { overridden: number; invalidated_by: string };
    expect(after.overridden).toBe(0);
    expect(after.invalidated_by).toBe("admin1");
    // No stock move either way (vial was really used).
    expect(getLot(db, lots.pcv.id)?.qtyOnHand).toBe(4);
    // Engine now treats it as not-overridden.
    const history = toEngineHistory(listDosesByChild(db, child.id), pack);
    expect(history.find((h) => h.productGroupId === "PCV_PRIMOVAX")?.overridden).toBe(false);
    revalidateDose(db, doseRow.id, "admin1", "second review: waiver stands");
    const back = db.prepare("SELECT * FROM doses WHERE id = ?").get(doseRow.id) as { overridden: number };
    expect(back.overridden).toBe(1);
    expect(getLot(db, lots.pcv.id)?.qtyOnHand).toBe(4);
    db.close();
  });

  it("API: permissions, review queue, and encounter ledger", async () => {
    const { db, child, lots } = setup();
    const app = buildApp(db, pack);
    const admin = await adminHeaders(db, app);
    createUser(db, { username: "n1", fullName: "N One", role: "nurse", password: "password-123", createdAt: "2026-10-13T10:00:00.000Z" });
    const login = JSON.parse((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "n1", password: "password-123" } })).body) as { sessionId: string };
    const nurse = { "x-api-token": login.sessionId };
    const { encounter } = recordCentre(db, child.id, "PENTA", lots.penta.id);
    // Nurse (not recorder) flag → 403; admin flag → ok.
    expect((await app.inject({ method: "POST", url: `/api/encounters/${encounter.id}/flag-void`, headers: nurse, payload: { reason: "x" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/encounters/${encounter.id}/flag-void`, headers: admin, payload: { reason: "admin-flag" } })).statusCode).toBe(200);
    // Nurse void → 403 (no visit.void); admin void → ok.
    expect((await app.inject({ method: "POST", url: `/api/encounters/${encounter.id}/void`, headers: nurse, payload: { reason: "x" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/encounters/${encounter.id}/void`, headers: admin, payload: { reason: "phantom" } })).statusCode).toBe(200);
    // Review queue serves admins, blocks nurses.
    expect((await app.inject({ method: "GET", url: "/api/review-queue", headers: nurse })).statusCode).toBe(403);
    const queue = JSON.parse((await app.inject({ method: "GET", url: "/api/review-queue", headers: admin })).body) as { voided: unknown[] };
    expect(queue.voided).toHaveLength(1);
    // Encounter ledger + dose details carry identity/status.
    const ledger = JSON.parse((await app.inject({ method: "GET", url: `/api/children/${child.id}/encounters`, headers: admin })).body) as { voidedAt: string | null }[];
    expect(ledger).toHaveLength(1);
    expect(ledger[0].voidedAt).not.toBeNull();
    const doses = JSON.parse((await app.inject({ method: "GET", url: `/api/children/${child.id}/doses`, headers: admin })).body) as unknown[];
    expect(doses).toHaveLength(0);
    db.close();
  });
});

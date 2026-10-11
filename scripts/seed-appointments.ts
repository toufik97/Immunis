/**
 * One-shot test-data helper: reconstruct the RDV each paper visit would have
 * set (same rule as recordVisit: first planned visit strictly after the
 * visit date). Past-due RDVs become no-show test rows; future ones fill the
 * session agenda.
 *
 * Idempotent: children that already have a pending appointment are skipped.
 *
 * Usage: npx tsx scripts/seed-appointments.ts [dbPath]
 */
import path from "node:path";
import { loadSchedulePack } from "../src/infra/packs/loader";
import { openDb } from "../src/infra/db/connection";
import { listChildren } from "../src/infra/repos/children";
import { listDosesByChild } from "../src/infra/repos/encounters";
import { createAppointment } from "../src/infra/repos/appointments";
import { evaluateChild } from "../src/app/evaluate-child";
import { todayLocal } from "../src/infra/time";

function main(): void {
  const dbPath = process.argv[2] ?? process.env.DB_PATH ?? path.join("data", "immunis.db");
  const today = todayLocal();
  const pack = loadSchedulePack(process.env.COUNTRY_PACK ?? "MA");
  const db = openDb(dbPath);

  const pending = new Set(
    (db.prepare("SELECT child_id FROM appointments WHERE kept IS NULL").all() as { child_id: string }[]).map(
      (r) => r.child_id
    )
  );

  let created = 0;
  let past = 0;
  let future = 0;
  let skippedPending = 0;
  let skippedDone = 0;
  for (const child of listChildren(db)) {
    if (pending.has(child.id)) {
      skippedPending++;
      continue;
    }
    const doses = listDosesByChild(db, child.id);
    // RDV the last visit would have set: evaluate there, take the first
    // planned visit strictly after it (recordVisit's nextExpectedProducts rule).
    const lastVisit = db
      .prepare("SELECT MAX(date) AS m FROM encounters WHERE child_id = ?")
      .get(child.id) as { m: string | null };
    const at = lastVisit.m ?? today;
    const result = evaluateChild(child.birthDate, doses, pack, at);
    const next = result.visitPlan.visits.find((v) => v.date > at && v.products.length > 0);
    if (!next) {
      skippedDone++;
      continue;
    }
    createAppointment(db, { childId: child.id, dueDate: next.date, expectedProducts: next.products });
    created++;
    if (next.date < today) past++;
    else future++;
  }
  console.log(`appointments created=${created} (past-due=${past} upcoming=${future}) skippedPending=${skippedPending} skippedFullyVaccinated=${skippedDone}`);
  db.close();
}

main();

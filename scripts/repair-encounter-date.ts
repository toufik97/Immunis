/**
 * One-shot repair: move a misfiled encounter to its true visit date.
 * Happens when doses were back-dated but the visit itself kept today's date:
 * the child lands on the wrong session day and the due appointment is wrongly
 * marked missed (kept = 0).
 *
 * What it fixes per encounter, atomically, after validating everything first:
 * - encounters.date → the true date
 * - appointments kept = 1 where due_date = true date (undoes the wrong miss)
 * - appointments kept = 0 where still pending and due before it (original rule)
 * - pending (unsynced) outbox payload date → the true date
 *
 * Refuses when: a dose would postdate the visit, a CENTRE lot would be
 * expired on the true date, or the outbox row already synced (central has it).
 *
 * Usage: npx tsx scripts/repair-encounter-date.ts <encounterId...> --date YYYY-MM-DD [--apply]
 * Without --apply it only prints the plan (dry run).
 */
import path from "node:path";
import { openDb } from "../src/infra/db/connection";
import { todayLocal } from "../src/infra/time";

interface Encounter {
  id: string;
  child_id: string;
  date: string;
}

function fail(msg: string): never {
  console.error(`refused: ${msg}`);
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  const dateFlag = args.indexOf("--date");
  const apply = args.includes("--apply");
  const ids = args.filter((a) => a !== "--apply" && a !== "--date" && (dateFlag === -1 || a !== args[dateFlag + 1]));
  const newDate = dateFlag === -1 ? undefined : args[dateFlag + 1];
  if (ids.length === 0 || !newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    fail("usage: npx tsx scripts/repair-encounter-date.ts <encounterId...> --date YYYY-MM-DD [--apply]");
  }
  if ((newDate as string) > todayLocal()) fail(`date ${newDate} is in the future`);

  const dbPath = process.env.DB_PATH ?? path.join("data", "immunis.db");
  const db = openDb(dbPath);

  // Validate everything before touching anything.
  const plans = ids.map((id) => {
    const enc = db.prepare("SELECT id, child_id, date FROM encounters WHERE id = ?").get(id) as Encounter | undefined;
    if (!enc) fail(`encounter ${id} not found`);
    const encounter = enc as Encounter;
    const doses = db
      .prepare("SELECT product_group_id, administered_on, origin, lot_id FROM doses WHERE encounter_id = ?")
      .all(id) as { product_group_id: string; administered_on: string; origin: string; lot_id: string | null }[];
    for (const d of doses) {
      if (d.administered_on > (newDate as string)) {
        fail(`encounter ${id}: dose ${d.product_group_id} dated ${d.administered_on} is after ${newDate}`);
      }
      if (d.origin === "CENTRE" && d.lot_id) {
        const lot = db.prepare("SELECT expiry_date FROM lots WHERE id = ?").get(d.lot_id) as { expiry_date: string } | undefined;
        if (!lot || lot.expiry_date < (newDate as string)) fail(`encounter ${id}: lot ${d.lot_id} unusable on ${newDate}`);
      }
    }
    const outbox = db
      .prepare("SELECT id, payload, synced_at FROM outbox WHERE payload LIKE ?")
      .all(`%${id}%`) as { id: string; payload: string; synced_at: string | null }[];
    for (const o of outbox) {
      if (o.synced_at) fail(`encounter ${id}: outbox ${o.id} already synced — fix centrally instead`);
    }
    const honoured = db
      .prepare("SELECT id, due_date, kept FROM appointments WHERE child_id = ? AND due_date = ? AND (kept IS NULL OR kept = 0)")
      .all(encounter.child_id, newDate) as { id: string; due_date: string; kept: number | null }[];
    const missed = db
      .prepare("SELECT id, due_date FROM appointments WHERE child_id = ? AND due_date < ? AND kept IS NULL")
      .all(encounter.child_id, newDate) as { id: string; due_date: string }[];
    return { encounter, doses: doses.length, outbox, honoured, missed };
  });

  for (const p of plans) {
    console.log(`encounter ${p.encounter.id} (child ${p.encounter.child_id}): ${p.encounter.date} → ${newDate} (${p.doses} doses)`);
    for (const a of p.honoured) console.log(`  appointment ${a.id} due ${a.due_date}: kept ${a.kept ?? "NULL"} → 1`);
    for (const a of p.missed) console.log(`  appointment ${a.id} due ${a.due_date}: kept NULL → 0`);
    for (const o of p.outbox) console.log(`  outbox ${o.id}: payload date → ${newDate}`);
  }

  if (!apply) {
    console.log("dry run — pass --apply to write");
    db.close();
    return;
  }

  const write = db.transaction(() => {
    for (const p of plans) {
      db.prepare("UPDATE encounters SET date = ? WHERE id = ?").run(newDate, p.encounter.id);
      for (const a of p.honoured) db.prepare("UPDATE appointments SET kept = 1 WHERE id = ?").run(a.id);
      for (const a of p.missed) db.prepare("UPDATE appointments SET kept = 0 WHERE id = ?").run(a.id);
      for (const o of p.outbox) {
        const payload = JSON.parse(o.payload) as Record<string, unknown>;
        payload["date"] = newDate;
        db.prepare("UPDATE outbox SET payload = ? WHERE id = ?").run(JSON.stringify(payload), o.id);
      }
    }
  });
  write();
  console.log("applied");
  db.close();
}

main();

/**
 * TESTING ONLY — never run silently in production (see docs/adr/003).
 * Realigns every pending appointment (kept IS NULL, future AND overdue) with
 * the engine's current recommendations: the database still holds predictions
 * frozen at booking time, which go stale after engine/pack updates.
 *
 * Pairing per child, both sorted chronologically: 1st pending ↔ 1st upcoming
 * engine visit (status DUE_NOW/DUE_FUTURE, never PROJECTED). Overdue engine
 * visits land on today. Surplus appointments (no engine visit left) and
 * children with no upcoming visit are flagged and left untouched.
 * Honored/missed rows (kept 0/1) are history and never touched.
 *
 * Usage: npx tsx scripts/realign-appointments.ts [dbPath] [--apply]
 * Without --apply it only prints the plan (dry run). Back up first:
 * sqlite3 <db> ".backup '<db>.bak-$(date +%F)-realign'"
 */
import path from "node:path";
import { openDb } from "../src/infra/db/connection";
import { loadSchedulePack } from "../src/infra/packs/loader";
import { listChildren } from "../src/infra/repos/children";
import { listDosesByChild } from "../src/infra/repos/encounters";
import { evaluateChild } from "../src/app/evaluate-child";
import { todayLocal } from "../src/infra/time";

function sameProducts(a: string[], b: string[]): boolean {
  const sa = [...a].sort().join("|");
  const sb = [...b].sort().join("|");
  return sa === sb;
}

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dbPath = args.find((a) => !a.startsWith("--")) ?? process.env.DB_PATH ?? path.join("data", "immunis.db");
  const today = todayLocal();
  const pack = loadSchedulePack(process.env.COUNTRY_PACK ?? "MA");
  const db = openDb(dbPath);

  let changed = 0;
  let unchanged = 0;
  const flagged: string[] = [];

  const update = apply
    ? db.transaction((id: string, dueDate: string, products: string[]) => {
      db.prepare("UPDATE appointments SET due_date = ?, expected_products = ? WHERE id = ?").run(
        dueDate,
        JSON.stringify(products),
        id
      );
    })
    : null;

  for (const child of listChildren(db)) {
    const pending = (
      db
        .prepare("SELECT id, due_date, expected_products, kept FROM appointments WHERE child_id = ? AND kept IS NULL ORDER BY due_date")
        .all(child.id) as { id: string; due_date: string; expected_products: string; kept: null }[]
    ).map((r) => {
      let products: string[] = [];
      try {
        const v: unknown = JSON.parse(r.expected_products);
        if (Array.isArray(v)) products = v.filter((x): x is string => typeof x === "string");
      } catch {
        /* keep empty */
      }
      return { id: r.id, dueDate: r.due_date, products };
    });
    if (pending.length === 0) continue;

    const result = evaluateChild(child.birthDate, listDosesByChild(db, child.id), pack, today, { projection: "full" });
    const upcoming = result.visitPlan.visits.filter((v) => v.status !== "PROJECTED");

    pending.forEach((appt, i) => {
      const visit = upcoming[i];
      if (!visit) {
        flagged.push(`${child.id}: appointment ${appt.id} due ${appt.dueDate} has no engine visit left (EXTRA, kept as-is)`);
        return;
      }
      const due = visit.date < today ? today : visit.date;
      if (appt.dueDate === due && sameProducts(appt.products, visit.products)) {
        unchanged++;
        return;
      }
      changed++;
      console.log(`${child.id}: ${appt.dueDate} [${appt.products.join(",")}] → ${due} [${visit.products.join(",")}]`);
      update?.(appt.id, due, visit.products);
    });
    if (upcoming.length > pending.length) {
      flagged.push(
        `${child.id}: ${upcoming.length - pending.length} upcoming engine visit(s) with no appointment (UNBOOKED from ${upcoming[pending.length].date})`
      );
    }
  }

  console.log(`\n${changed} to update, ${unchanged} unchanged, ${flagged.length} flagged`);
  for (const f of flagged) console.log(`flag: ${f}`);
  if (!apply) console.log("dry run — back up the DB, review, then pass --apply");
  db.close();
}

main();

/**
 * One-shot: fill children.sex from the paper-register CSV sexe column
 * (row n ↔ TEST-n family names from scripts/seed-test-db.ts).
 * Blank cells get a random value (test data only), then any leftover
 * NULL is swept randomly.
 *
 * Usage: npx tsx scripts/backfill-sex.ts "Untitled spreadsheet - Sheet1(1).csv" [dbPath]
 */
import fs from "node:fs";
import path from "node:path";
import { openDb } from "../src/infra/db/connection";

function main(): void {
  const csvPath = process.argv[2] ?? "Untitled spreadsheet - Sheet1(1).csv";
  const dbPath = process.argv[3] ?? process.env.DB_PATH ?? path.join("data", "immunis.db");
  const db = openDb(dbPath);

  const raw = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const rows = raw.split(/\r?\n/).filter((l) => l.trim() !== "").slice(1);

  const set = db.prepare("UPDATE children SET sex = ? WHERE family_name = ? AND (sex IS NULL OR sex = '')");
  let mapped = 0;
  let random = 0;
  rows.forEach((line, idx) => {
    const cells = line.split(",");
    const s = (cells[2] ?? "").trim().toLowerCase();
    const sex = s === "f" ? "F" : s === "m" ? "M" : Math.random() < 0.5 ? "M" : "F";
    if (s !== "f" && s !== "m") random++;
    const r = set.run(sex, `TEST-${idx + 1}`);
    mapped += r.changes;
  });
  const swept = db
    .prepare("UPDATE children SET sex = CASE WHEN abs(random()) % 2 = 0 THEN 'M' ELSE 'F' END WHERE sex IS NULL OR sex = ''")
    .run().changes;
  const left = (db.prepare("SELECT COUNT(*) AS n FROM children WHERE sex IS NULL OR sex = ''").get() as { n: number }).n;
  const counts = db.prepare("SELECT sex, COUNT(*) AS n FROM children GROUP BY sex").all() as { sex: string; n: number }[];
  console.log(`mapped=${mapped} randomCells=${random} swept=${swept} leftNull=${left} distribution=${JSON.stringify(counts)}`);
  db.close();
}

main();

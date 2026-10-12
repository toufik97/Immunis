/**
 * Test-DB reseed from the paper-register CSV.
 *
 * DANGER: wipes children/encounters/doses/appointments/outbox/audit-linked rows
 * (overrides is append-only, so the DB file is rebuilt). A timestamped backup
 * is written next to the DB first.
 *
 * Usage:
 *   DB_PATH=data/immunis.db npx tsx scripts/seed-test-db.ts "Untitled spreadsheet - Sheet1(1).csv" [dbPath]
 *
 * Mapping (column header -> product groups, one encounter per distinct date):
 *   bcg,vpo,vitd,hb      -> BCG, VPO, VITD, HB_MONO
 *   penta,vpo,rota        -> PENTA, VPO, ROTAVIRUS            (x2 columns)
 *   penta,vpo,rota,vpi    -> PENTA, VPO, ROTAVIRUS, VPI
 *   pneumo 1 / pneumo 2   -> PCV_PREVENAR if same day as a neighbouring
 *                            penta/vit date, else PCV_PRIMOVAX
 *   pneumo 3              -> PCV_PRIMOVAX (always)
 *   pneumo4 (+vita2)      -> brand continuity (PRIMOVAX if any earlier
 *                            pneumo was PRIMOVAX, else PREVENAR) + VITA
 *   vitA/D                -> VITA (assumption: 6-month Vit A; vita2/vita3
 *                            later confirm the A track)
 *   RR                    -> RR
 *   DTC1,vpo,rr2,vita3    -> DTC, VPO, RR, VITA
 *   DTC2,vpo              -> DTC, VPO
 * History is recorded as EXTERNAL (transcribed paper): the engine still
 * credits it clinically, but it skips the record gate and never touches stock.
 */
import fs from "node:fs";
import path from "node:path";
import { openDb } from "../src/infra/db/connection";
import { registerChild } from "../src/app/register-child";
import { recordEncounter } from "../src/infra/repos/encounters";
import { addLot } from "../src/infra/repos/stock";
import { todayLocal } from "../src/infra/time";

const CENTRE_ID = "CS01";
const SEED_QTY = 500;
const SEED_EXPIRY = "2030-12-31";

const STOCK_PRODUCTS = [
  "BCG", "VPO", "VPI", "PENTA", "DTC", "TD", "HB_MONO",
  "PCV_PRIMOVAX", "PCV_PREVENAR", "ROTAVIRUS", "RR", "RRO", "VAR",
  "VITD", "VITA",
];

/** DD/MM/YYYY -> YYYY-MM-DD, null when not a real calendar date. */
function toIso(raw: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (y < 1000 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function main(): void {
  const csvPath = process.argv[2] ?? "Untitled spreadsheet - Sheet1(1).csv";
  const dbPath = process.argv[3] ?? process.env.DB_PATH ?? path.join("data", "immunis.db");
  const today = todayLocal();
  const warnings: string[] = [];

  const raw = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "");
  const rows = lines.slice(1).map((l) => {
    const cells = l.split(",");
    while (cells.length < 16) cells.push("");
    return cells;
  });

  // Rebuild the file: overrides is append-only (trigger blocks DELETE) and its
  // rows reference children, so in-place wipe cannot work. Backup first.
  if (fs.existsSync(dbPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const bak = `${dbPath}.bak-${stamp}`;
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(dbPath + suffix)) fs.copyFileSync(dbPath + suffix, bak + suffix);
    }
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(dbPath + suffix)) fs.rmSync(dbPath + suffix);
    }
    console.log(`backup: ${bak}`);
  }

  const db = openDb(dbPath);
  for (const p of STOCK_PRODUCTS) {
    addLot(db, { productGroupId: p, lotNumber: `TEST-${p}`, expiryDate: SEED_EXPIRY, coldChainOk: true, qtyOnHand: SEED_QTY });
  }
  // Keep an expired-lot fixture so expiry paths stay testable.
  addLot(db, { productGroupId: "HB_MONO", lotNumber: "TEST-EXPIRED", expiryDate: "2023-01-01", coldChainOk: true, qtyOnHand: 10 });

  let children = 0;
  let encounters = 0;
  let doses = 0;
  let skippedRows = 0;
  let skippedCells = 0;
  let nPrevenar = 0;
  let nPrimovax = 0;

  rows.forEach((f, idx) => {
    const n = idx + 1;
    const birth = toIso(f[3] ?? "");
    if (!birth) {
      skippedRows++;
      warnings.push(`row ${n}: no usable birth date, skipped`);
      return;
    }
    if (birth > today) {
      skippedRows++;
      warnings.push(`row ${n}: birth ${birth} in the future, skipped`);
      return;
    }
    // Column dates as ISO (C5..C16 = fields 4..15).
    const c = (i: number): string | null => {
      const cell = (f[i] ?? "").trim();
      if (!cell) return null;
      const iso = toIso(cell);
      if (!iso) {
        skippedCells++;
        warnings.push(`row ${n}: ignoring bad date "${cell}"`);
      }
      return iso;
    };
    const dBirth = birth;
    const dC5 = c(4);
    const dC6 = c(5);
    const dP1 = c(6);
    const dC8 = c(7);
    const dC9 = c(8);
    const dP2 = c(9);
    const dC11 = c(10);
    const dP3 = c(11);
    const dRR = c(12);
    const dP4 = c(13);
    const dC15 = c(14);
    const dC16 = c(15);

    const sameDay = (a: string | null, b: string | null): boolean => !!a && a === b;
    const bP1 = dP1 && (sameDay(dP1, dC6) || sameDay(dP1, dC8)) ? "PCV_PREVENAR" : "PCV_PRIMOVAX";
    const bP2 = dP2 && (sameDay(dP2, dC9) || sameDay(dP2, dC11)) ? "PCV_PREVENAR" : "PCV_PRIMOVAX";
    // pneumo4 follows brand continuity of the earlier pneumo doses.
    const bP4 = [dP1 && bP1, dP2 && bP2, dP3 && "PCV_PRIMOVAX"].includes("PCV_PRIMOVAX")
      ? "PCV_PRIMOVAX"
      : "PCV_PREVENAR";

    const visits = new Map<string, Set<string>>();
    const put = (date: string | null, products: string[]): void => {
      if (!date) return;
      if (date < dBirth || date > today) {
        skippedCells++;
        warnings.push(`row ${n}: dose date ${date} outside [birth, today], skipped`);
        return;
      }
      let set = visits.get(date);
      if (!set) visits.set(date, (set = new Set()));
      for (const p of products) set.add(p);
    };
    put(dC5, ["BCG", "VPO", "VITD", "HB_MONO"]);
    put(dC6, ["PENTA", "VPO", "ROTAVIRUS"]);
    if (dP1) {
      put(dP1, [bP1]);
      if (bP1 === "PCV_PREVENAR") nPrevenar++;
      else nPrimovax++;
    }
    put(dC8, ["PENTA", "VPO", "ROTAVIRUS"]);
    put(dC9, ["PENTA", "VPO", "ROTAVIRUS", "VPI"]);
    if (dP2) {
      put(dP2, [bP2]);
      if (bP2 === "PCV_PREVENAR") nPrevenar++;
      else nPrimovax++;
    }
    put(dC11, ["VITA"]);
    if (dP3) {
      put(dP3, ["PCV_PRIMOVAX"]);
      nPrimovax++;
    }
    put(dRR, ["RR"]);
    if (dP4) {
      put(dP4, [bP4, "VITA"]);
      if (bP4 === "PCV_PREVENAR") nPrevenar++;
      else nPrimovax++;
    }
    put(dC15, ["DTC", "VPO", "RR", "VITA"]);
    put(dC16, ["DTC", "VPO"]);

    const dates = [...visits.keys()].sort();
    const firstYear = (dates[0] ?? dBirth).slice(0, 4);
    // CSV sexe column; empty cells get a random value (test data only).
    const s = (f[2] ?? "").trim().toLowerCase();
    const sex: "M" | "F" = s === "f" ? "F" : s === "m" ? "M" : Math.random() < 0.5 ? "M" : "F";
    const res = registerChild(db, {
      familyName: `TEST-${n}`,
      givenName: `Enfant-${n}`,
      birthDate: dBirth,
      sex,
      address: `Adresse fictive ${n} (donnees de test)`,
      centreId: CENTRE_ID,
      firstVisitYear: firstYear,
      force: true,
    });
    if (res.status !== "created") throw new Error(`row ${n}: unexpected duplicate`);
    children++;

    const seen = new Set<string>();
    for (const date of dates) {
      const products = [...visits.get(date)!].filter((p) => {
        const key = `${p}|${date}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (products.length === 0) continue;
      recordEncounter(db, {
        childId: res.child.id,
        date,
        screening: "VACCINATE",
        doses: products.map((productGroupId) => ({
          productGroupId,
          administeredOn: date,
          origin: "EXTERNAL" as const,
          overridden: false,
          recordedBy: "seed-import",
        })),
      });
      encounters++;
      doses += products.length;
    }
  });

  console.log(`children=${children} encounters=${encounters} doses=${doses}`);
  console.log(`pneumo brands: PREVENAR=${nPrevenar} PRIMOVAX=${nPrimovax}`);
  console.log(`skipped rows=${skippedRows} cells=${skippedCells}`);
  const show = warnings.slice(0, 40);
  for (const w of show) console.log(`warn: ${w}`);
  if (warnings.length > show.length) console.log(`... +${warnings.length - show.length} more warnings`);
  db.close();
}

main();

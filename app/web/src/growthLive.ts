/**
 * Client-side WHO growth math for live words while typing.
 * Same tables, same formula as the server (src/growth/zscore.ts) — one
 * bundled source of truth (tables.json), so the preview always matches.
 */
import tables from "./growthTables.json";

export type Indicator = "wfa" | "lhfa" | "bfa" | "wfl";
export type Band = "low3" | "low2" | "ok" | "high2" | "high3" | null;

const MONTHS = 60;
const WEEK_CUTOFF_DAYS = 91;
const DAYS_PER_MONTH = 365.25 / 12;
const DAYS_PER_WEEK = 7;

type Tables = typeof tables;

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

type Lms = [number, number, number];

function lmsRows(rows: Lms[], x: number): { l: number; m: number; s: number } | null {
  if (!rows || rows.length === 0 || !Number.isFinite(x) || x < 0) return null;
  const max = rows.length - 1;
  if (x > max) return null;
  const lo = Math.min(Math.floor(x), max - 1);
  const f = Math.min(Math.max(x - lo, 0), 1);
  const [l0, m0, s0] = rows[lo];
  const [l1, m1, s1] = rows[lo + 1];
  return { l: lerp(l0, l1, f), m: lerp(m0, m1, f), s: lerp(s0, s1, f) };
}

function zFromLms(p: { l: number; m: number; s: number }, value: number): number {
  const raw = (Math.pow(value / p.m, p.l) - 1) / (p.l * p.s);
  const at = (z: number): number => p.m * Math.pow(1 + p.l * p.s * z, 1 / p.l);
  if (raw > 3) return 3 + (value - at(3)) / (at(3) - at(2));
  if (raw < -3) return -3 + (value - at(-3)) / (at(-2) - at(-3));
  return raw;
}

function zAge(
  t: Tables,
  ind: "wfa" | "lhfa" | "bfa",
  sex: "M" | "F",
  ageDays: number,
  value: number
): number | null {
  if (!(value > 0)) return null;
  const set = ageDays < WEEK_CUTOFF_DAYS ? t.weekly[ind][sex] : t.monthly[ind][sex];
  const x = ageDays < WEEK_CUTOFF_DAYS ? ageDays / DAYS_PER_WEEK : ageDays / DAYS_PER_MONTH;
  const p = lmsRows(set as unknown as Lms[], x);
  return p ? zFromLms(p, value) : null;
}

function zLength(t: Tables, kind: "wfl" | "wfh", sex: "M" | "F", lenCm: number, value: number): number | null {
  if (!(value > 0) || !(lenCm > 0)) return null;
  const rows = (t[kind][sex] as unknown as Lms[]).map((r) => r);
  const base = kind === "wfl" ? 45 : 65;
  const p = lmsRows(rows, (lenCm - base) / 0.5);
  return p ? zFromLms(p, value) : null;
}

export function bandOf(z: number | null): Band {
  if (z === null || !Number.isFinite(z)) return null;
  if (z < -3) return "low3";
  if (z < -2) return "low2";
  if (z <= 2) return "ok";
  if (z <= 3) return "high2";
  return "high3";
}

/** Whole days between two YYYY-MM-DD dates (b - a). */
export function ageDaysBetween(birthIso: string, dateIso: string): number {
  const t = (s: string): number =>
    Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(dateIso) - t(birthIso)) / 86_400_000);
}

export interface LiveScore {
  z: number | null;
  band: Band;
}

/** Live words for typed weight/height at a visit date. Null when nothing to score. */
export function scoreLive(
  sex: string | null | undefined,
  birthIso: string,
  visitDate: string,
  weightKg: number | null,
  heightCm: number | null
): Record<Indicator, LiveScore> | null {
  if (sex !== "M" && sex !== "F") return null;
  const t = tables as unknown as Tables;
  const ageDays = ageDaysBetween(birthIso, visitDate);
  if (ageDays < 0 || ageDays / DAYS_PER_MONTH > MONTHS) return null;
  const w = weightKg !== null && weightKg > 0 ? weightKg : null;
  const h = heightCm !== null && heightCm > 0 ? heightCm : null;
  const bmi = w !== null && h !== null ? w / Math.pow(h / 100, 2) : null;
  const young = ageDays / DAYS_PER_MONTH < 24;
  const zw = w === null ? null : zAge(t, "wfa", sex, ageDays, w);
  const zh = h === null ? null : zAge(t, "lhfa", sex, ageDays, h);
  const zb = bmi === null ? null : zAge(t, "bfa", sex, ageDays, bmi);
  const zl = w === null || h === null ? null : zLength(t, young ? "wfl" : "wfh", sex, h, w);
  return {
    wfa: { z: zw, band: bandOf(zw) },
    lhfa: { z: zh, band: bandOf(zh) },
    bfa: { z: zb, band: bandOf(zb) },
    wfl: { z: zl, band: bandOf(zl) },
  };
}

/** i18n key for an interpretation badge. Weight-for-length shares the BMI wording. */
export function interpKey(ind: Indicator, band: Band): string | null {
  if (!band) return null;
  const key = ind === "wfl" ? "bfa" : ind;
  if (band === "low3" || band === "low2" || band === "ok") return `growth.${key}.${band}`;
  if (ind === "bfa" || ind === "wfl") return `growth.bfa.${band}`;
  return `growth.${ind}.high`;
}

export function bandColor(band: Band): string {
  if (band === "low3" || band === "high3") return "red";
  if (band === "low2") return "orange";
  if (band === "ok") return "teal";
  return "yellow";
}

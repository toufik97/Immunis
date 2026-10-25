import tables from "./tables.json";

/**
 * WHO 0–5y growth z-scores (Box-Cox LMS, linear interpolation — the WHO Anthro
 * method). Under 91 days the weekly 0–13w tables are used (newborns change
 * fast; monthly points smooth them wrongly). Weight-for-length uses the
 * length tables (45–110 cm) under 24 months and the height tables
 * (65–120 cm) at/after 24 months. Range: 0–60 months.
 */

type Sex = "M" | "F";
export type Indicator = "wfa" | "lhfa" | "bfa" | "wfl";
type AgeIndicator = "wfa" | "lhfa" | "bfa";

interface LMS {
  l: number;
  m: number;
  s: number;
}

const MONTHS = 60;
const WEEKS = 13;
const WEEK_CUTOFF_DAYS = 91;
const DAYS_PER_MONTH = 365.25 / 12;
const DAYS_PER_WEEK = 7;

type Tables = typeof tables;

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

function lmsMonthly(t: Tables, ind: AgeIndicator, sex: Sex, ageDays: number): LMS | null {
  if (ageDays < 0) return null;
  const months = ageDays / DAYS_PER_MONTH;
  if (months > MONTHS) return null;
  const rows = t.monthly[ind][sex];
  const lo = Math.min(Math.floor(months), MONTHS - 1);
  const f = Math.min(Math.max(months - lo, 0), 1);
  const [l0, m0, s0] = rows[lo];
  const [l1, m1, s1] = rows[lo + 1];
  return { l: lerp(l0, l1, f), m: lerp(m0, m1, f), s: lerp(s0, s1, f) };
}

function lmsWeekly(t: Tables, ind: AgeIndicator, sex: Sex, ageDays: number): LMS | null {
  if (ageDays < 0 || ageDays >= WEEK_CUTOFF_DAYS + 7) return null;
  const rows = t.weekly[ind][sex];
  const weeks = ageDays / DAYS_PER_WEEK;
  const lo = Math.min(Math.floor(weeks), WEEKS - 1);
  const f = Math.min(Math.max(weeks - lo, 0), 1);
  const [l0, m0, s0] = rows[lo];
  const [l1, m1, s1] = rows[lo + 1];
  return { l: lerp(l0, l1, f), m: lerp(m0, m1, f), s: lerp(s0, s1, f) };
}

function lmsAt(t: Tables, ind: AgeIndicator, sex: Sex, ageDays: number): LMS | null {
  if (!Number.isFinite(ageDays) || ageDays < 0) return null;
  if (ageDays < WEEK_CUTOFF_DAYS) return lmsWeekly(t, ind, sex, ageDays);
  return lmsMonthly(t, ind, sex, ageDays);
}

/** LMS row lookup by body length/height in cm (0.5 cm steps). */
function lmsAtLength(t: Tables, kind: "wfl" | "wfh", sex: Sex, lenCm: number): LMS | null {
  if (!Number.isFinite(lenCm)) return null;
  const rows = t[kind][sex];
  const base = kind === "wfl" ? 45 : 65;
  const top = kind === "wfl" ? 110 : 120;
  if (lenCm < base || lenCm > top) return null;
  const x = (lenCm - base) / 0.5;
  const lo = Math.min(Math.floor(x), rows.length - 2);
  const f = Math.min(Math.max(x - lo, 0), 1);
  const [l0, m0, s0] = rows[lo];
  const [l1, m1, s1] = rows[lo + 1];
  return { l: lerp(l0, l1, f), m: lerp(m0, m1, f), s: lerp(s0, s1, f) };
}

function valueAt(p: LMS, z: number): number {
  return p.m * Math.pow(1 + p.l * p.s * z, 1 / p.l);
}

function zFromLms(p: LMS, value: number): number {
  const raw = (Math.pow(value / p.m, p.l) - 1) / (p.l * p.s);
  if (raw > 3) {
    const sd3 = valueAt(p, 3);
    const sd2 = valueAt(p, 2);
    return 3 + (value - sd3) / (sd3 - sd2);
  }
  if (raw < -3) {
    const sd3 = valueAt(p, -3);
    const sd2 = valueAt(p, -2);
    return -3 + (value - sd3) / (sd2 - sd3);
  }
  return raw;
}

/** Box-Cox z, with the WHO Anthro adjustment beyond ±3. Null when not computable. */
export function zScore(indicator: AgeIndicator, sex: Sex, ageDays: number, value: number): number | null {
  if (!(value > 0)) return null;
  const p = lmsAt(tables as unknown as Tables, indicator, sex, ageDays);
  return p ? zFromLms(p, value) : null;
}

/** Weight-for-length/height z (length < 24 mo, height >= 24 mo). Null outside 45–110 / 65–120 cm. */
export function zByLength(kind: "wfl" | "wfh", sex: Sex, lenCm: number, weightKg: number): number | null {
  if (!(weightKg > 0) || !(lenCm > 0)) return null;
  const p = lmsAtLength(tables as unknown as Tables, kind, sex, lenCm);
  return p ? zFromLms(p, weightKg) : null;
}

/** Reference-curve value (e.g. median, ±SD) at an exact age in days. Null out of range. */
export function valueAtZ(indicator: AgeIndicator, sex: Sex, ageDays: number, z: number): number | null {
  const p = lmsAt(tables as unknown as Tables, indicator, sex, ageDays);
  return p ? valueAt(p, z) : null;
}

/** Reference value on the length/height scale (for the wfl/wfh carnet curve). */
export function valueAtLength(kind: "wfl" | "wfh", sex: Sex, lenCm: number, z: number): number | null {
  const p = lmsAtLength(tables as unknown as Tables, kind, sex, lenCm);
  return p ? valueAt(p, z) : null;
}

export type Band = "low3" | "low2" | "ok" | "high2" | "high3" | null;

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

export interface GrowthPoint {
  date: string;
  ageDays: number;
  ageMonths: number;
  weightKg: number | null;
  heightCm: number | null;
  bmi: number | null;
  z: { wfa: number | null; lhfa: number | null; bfa: number | null; wfl: number | null };
  /** length scale for the wfl curve point: "length" under 24 mo, "height" after. */
  wflKind: "length" | "height" | null;
}

/** One visit's measures + scores. Null where a measure is missing or out of range. */
export function scorePoint(
  birthIso: string,
  sex: Sex,
  date: string,
  weightKg: number | null,
  heightCm: number | null
): GrowthPoint {
  const ageDays = ageDaysBetween(birthIso, date);
  const inRange = ageDays >= 0 && ageDays / DAYS_PER_MONTH <= MONTHS;
  const w = weightKg && weightKg > 0 ? weightKg : null;
  const h = heightCm && heightCm > 0 ? heightCm : null;
  const bmi = w !== null && h !== null ? w / Math.pow(h / 100, 2) : null;
  const young = ageDays / DAYS_PER_MONTH < 24;
  const wflKind = h === null ? null : young ? ("length" as const) : ("height" as const);
  const wfl = w === null || h === null || !inRange ? null : zByLength(young ? "wfl" : "wfh", sex, h, w);
  return {
    date,
    ageDays,
    ageMonths: Math.floor((ageDays / DAYS_PER_MONTH) * 10) / 10,
    weightKg: w,
    heightCm: h,
    bmi: bmi === null ? null : Math.round(bmi * 10) / 10,
    z: {
      wfa: w === null || !inRange ? null : zScore("wfa", sex, ageDays, w),
      lhfa: h === null || !inRange ? null : zScore("lhfa", sex, ageDays, h),
      bfa: bmi === null || !inRange ? null : zScore("bfa", sex, ageDays, bmi),
      wfl,
    },
    wflKind,
  };
}

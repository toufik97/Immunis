import tables from "./tables.json";

/**
 * WHO 0–5y growth z-scores (Box-Cox LMS, linear interpolation of L/M/S
 * between completed months — the WHO Anthro method).
 * Assumption: measured value is length if age < 24mo, height if >= 24mo
 * (no lying/standing flag is recorded; record position correctly).
 * Range: 0–60 months; older children get no score (null).
 */

type Sex = "M" | "F";
type Indicator = "wfa" | "lhfa" | "bfa";

interface LMS {
  l: number;
  m: number;
  s: number;
}

const MONTHS = 60;
const DAYS_PER_MONTH = 365.25 / 12;

function rows(indicator: Indicator, sex: Sex): number[][] {
  const t = (tables as unknown as Record<string, Record<string, number[][]>>)[indicator]?.[sex];
  if (!t || t.length !== MONTHS + 1) throw new Error(`missing WHO table ${indicator}/${sex}`);
  return t;
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

/** Interpolated LMS at an exact age in days. Null when out of range. */
export function lmsAt(indicator: Indicator, sex: Sex, ageDays: number): LMS | null {
  if (!Number.isFinite(ageDays) || ageDays < 0) return null;
  const ageMonths = ageDays / DAYS_PER_MONTH;
  if (ageMonths > MONTHS) return null;
  const t = rows(indicator, sex);
  const lo = Math.min(Math.floor(ageMonths), MONTHS - 1);
  const f = Math.min(Math.max(ageMonths - lo, 0), 1);
  const [l0, m0, s0] = t[lo];
  const [l1, m1, s1] = t[lo + 1];
  return { l: lerp(l0, l1, f), m: lerp(m0, m1, f), s: lerp(s0, s1, f) };
}

function valueAt(lms: LMS, z: number): number {
  return lms.m * Math.pow(1 + lms.l * lms.s * z, 1 / lms.l);
}

/** Reference-curve value (e.g. median, ±2 SD) at an exact age in days. Null out of range. */
export function valueAtZ(indicator: Indicator, sex: Sex, ageDays: number, z: number): number | null {
  const p = lmsAt(indicator, sex, ageDays);
  return p ? valueAt(p, z) : null;
}

/**
 * Box-Cox z, with the WHO Anthro adjustment beyond ±3 so extreme scores
 * stay on a meaningful scale instead of exploding.
 */
export function zScore(indicator: Indicator, sex: Sex, ageDays: number, value: number): number | null {
  const p = lmsAt(indicator, sex, ageDays);
  if (!p || !(value > 0)) return null;
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

export type Band = "low3" | "low2" | "ok" | "high2" | "high3";

export function bandOf(z: number | null): Band | null {
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
  z: { wfa: number | null; lhfa: number | null; bfa: number | null };
}

/** One visit's measures + scores. Nulls where a measure is missing or out of range. */
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
    },
  };
}

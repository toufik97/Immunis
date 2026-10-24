/**
 * Client-side growth math for live preview (same formula as the server,
 * src/growth/zscore.ts). Uses the monthly LMS tables already fetched for the
 * child, so it also works offline once loaded. The saved result from the
 * server stays the truth; this preview must match it.
 */

export type Indicator = "wfa" | "lhfa" | "bfa";
export type Band = "low3" | "low2" | "ok" | "high2" | "high3" | null;

/** Monthly [L, M, S] rows, month 0..60. */
export type LmsRows = [number, number, number][];

export interface GrowthRefs {
  neg2: number[];
  med: number[];
  pos2: number[];
  lms: LmsRows;
}

const MONTHS = 60;
const DAYS_PER_MONTH = 365.25 / 12;

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

function lmsAt(lms: LmsRows, ageDays: number): { l: number; m: number; s: number } | null {
  if (!Number.isFinite(ageDays) || ageDays < 0 || !lms || lms.length !== MONTHS + 1) return null;
  const ageMonths = ageDays / DAYS_PER_MONTH;
  if (ageMonths > MONTHS) return null;
  const lo = Math.min(Math.floor(ageMonths), MONTHS - 1);
  const f = Math.min(Math.max(ageMonths - lo, 0), 1);
  const [l0, m0, s0] = lms[lo];
  const [l1, m1, s1] = lms[lo + 1];
  return { l: lerp(l0, l1, f), m: lerp(m0, m1, f), s: lerp(s0, s1, f) };
}

function valueAt(p: { l: number; m: number; s: number }, z: number): number {
  return p.m * Math.pow(1 + p.l * p.s * z, 1 / p.l);
}

function zScore(lms: LmsRows, ageDays: number, value: number): number | null {
  const p = lmsAt(lms, ageDays);
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

/**
 * Live words for typed weight/height at a visit date. Null when nothing to
 * score yet (missing measure, unknown sex, out of 0–5y range).
 */
export function scoreLive(
  refs: Record<Indicator, GrowthRefs> | null,
  sex: string | null | undefined,
  birthIso: string,
  visitDate: string,
  weightKg: number | null,
  heightCm: number | null
): Record<Indicator, LiveScore> | null {
  if (!refs || (sex !== "M" && sex !== "F")) return null;
  const ageDays = ageDaysBetween(birthIso, visitDate);
  const w = weightKg !== null && weightKg > 0 ? weightKg : null;
  const h = heightCm !== null && heightCm > 0 ? heightCm : null;
  const bmi = w !== null && h !== null ? w / Math.pow(h / 100, 2) : null;
  const zw = w === null ? null : zScore(refs.wfa.lms, ageDays, w);
  const zh = h === null ? null : zScore(refs.lhfa.lms, ageDays, h);
  const zb = bmi === null ? null : zScore(refs.bfa.lms, ageDays, bmi);
  return {
    wfa: { z: zw, band: bandOf(zw) },
    lhfa: { z: zh, band: bandOf(zh) },
    bfa: { z: zb, band: bandOf(zb) },
  };
}

/** i18n key for an interpretation badge, or null when nothing to say. */
export function interpKey(ind: Indicator, band: Band): string | null {
  if (!band) return null;
  if (band === "low3" || band === "low2" || band === "ok") return `growth.${ind}.${band}`;
  if (ind === "bfa") return `growth.bfa.${band}`;
  return `growth.${ind}.high`;
}

export function bandColor(band: Band): string {
  if (band === "low3" || band === "high3") return "red";
  if (band === "low2") return "orange";
  if (band === "ok") return "teal";
  return "yellow";
}

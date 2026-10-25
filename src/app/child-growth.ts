import type Database from "better-sqlite3";
import { listGrowthMeasures } from "../infra/repos/encounters";
import { scorePoint, valueAtZ, valueAtLength, type GrowthPoint } from "../growth/zscore";

export interface GrowthCurve {
  /** x axis: months for wfa/lhfa/bfa, cm for wfl. */
  xs: number[];
  neg2: number[];
  med: number[];
  pos2: number[];
}

export interface GrowthRefsBundle {
  wfa: GrowthCurve;
  lhfa: GrowthCurve;
  bfa: GrowthCurve;
  wfl: GrowthCurve;
}

/**
 * Growth history for one child: every visit that recorded weight and/or
 * height, scored against WHO 0–5y (Box-Cox LMS, weekly tables under 91 days),
 * plus reference curves for the carnet chart. The weight-for-length curve
 * uses the length scale under 24 mo and the height scale after (WHO).
 * No DB writes, no engine involvement: pure reading + math.
 */
export function growthFor(
  db: Database.Database,
  input: { childId: string; birthDate: string; sex: "M" | "F" }
): { points: GrowthPoint[]; refs: GrowthRefsBundle; wflKind: "length" | "height" } {
  const points = listGrowthMeasures(db, input.childId);
  const scored = points.map((m) => scorePoint(input.birthDate, input.sex, m.date, m.weightKg, m.heightCm));

  const months = Array.from({ length: 61 }, (_, m) => m);
  const refs = {} as GrowthRefsBundle;
  (["wfa", "lhfa", "bfa"] as const).forEach((ind) => {
    const neg2: number[] = [];
    const med: number[] = [];
    const pos2: number[] = [];
    for (let m = 0; m <= 60; m++) {
      const days = (m * 365.25) / 12;
      neg2.push(valueAtZ(ind, input.sex, days, -2) ?? NaN);
      med.push(valueAtZ(ind, input.sex, days, 0) ?? NaN);
      pos2.push(valueAtZ(ind, input.sex, days, 2) ?? NaN);
    }
    refs[ind] = { xs: months, neg2, med, pos2 };
  });

  // Weight-for-length scale follows the child: length under 24 mo, height after.
  const lastAge = scored.length > 0 ? scored[scored.length - 1].ageMonths : 0;
  const kind = lastAge >= 24 ? ("wfh" as const) : ("wfl" as const);
  const lo = kind === "wfl" ? 45 : 65;
  const hi = kind === "wfl" ? 110 : 120;
  const xs: number[] = [];
  const neg2: number[] = [];
  const med: number[] = [];
  const pos2: number[] = [];
  for (let x = lo; x <= hi; x += 1) {
    xs.push(x);
    neg2.push(valueAtLength(kind, input.sex, x, -2) ?? NaN);
    med.push(valueAtLength(kind, input.sex, x, 0) ?? NaN);
    pos2.push(valueAtLength(kind, input.sex, x, 2) ?? NaN);
  }
  refs.wfl = { xs, neg2, med, pos2 };

  // Weight-for-length vs weight-for-height share one slot; the UI labels the scale.
  const wflKind = kind === "wfl" ? ("length" as const) : ("height" as const);
  return { points: scored, refs, wflKind };
}

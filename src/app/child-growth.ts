import type Database from "better-sqlite3";
import { listGrowthMeasures } from "../infra/repos/encounters";
import { scorePoint, valueAtZ, type GrowthPoint } from "../growth/zscore";

export interface GrowthRefs {
  neg2: number[];
  med: number[];
  pos2: number[];
}

/**
 * Growth history for one child: every visit that recorded weight and/or
 * height, scored against WHO 0–5y (Box-Cox LMS), plus monthly reference
 * curves (median, ±2 SD) for the carnet chart. No DB writes, no engine
 * involvement: pure reading + math.
 */
export function growthFor(
  db: Database.Database,
  input: { childId: string; birthDate: string; sex: "M" | "F" }
): { points: GrowthPoint[]; refs: Record<"wfa" | "lhfa" | "bfa", GrowthRefs> } {
  const points = listGrowthMeasures(db, input.childId);
  const refs = {} as Record<"wfa" | "lhfa" | "bfa", GrowthRefs>;
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
    refs[ind] = { neg2, med, pos2 };
  });
  return { points: points.map((m) => scorePoint(input.birthDate, input.sex, m.date, m.weightKg, m.heightCm)), refs };
}

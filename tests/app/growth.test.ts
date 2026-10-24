import { describe, it, expect } from "vitest";
import { openTestDb, adminHeaders } from "./db-helper";
import { loadSchedulePack } from "../../src/infra/packs/loader";
import { buildApp } from "../../src/api/app";
import { ageDaysBetween, bandOf, lmsAt, scorePoint, zScore } from "../../src/growth/zscore";
import { growthFor } from "../../src/app/child-growth";
import { recordEncounter } from "../../src/infra/repos/encounters";
import tables from "../../src/growth/tables.json";
import { scoreLive } from "../../app/web/src/growthLive";

const pack = loadSchedulePack("MA");

describe("WHO growth scores", () => {
  it("scores ~0 at the published medians", () => {
    // Boy, birth: median weight 3.3464 kg, median length 49.8842 cm.
    const p = scorePoint("2026-01-01", "M", "2026-01-01", 3.3464, 49.8842);
    expect(Math.abs(p.z.wfa ?? 99)).toBeLessThan(0.01);
    expect(Math.abs(p.z.lhfa ?? 99)).toBeLessThan(0.01);
    expect(p.bmi).toBeCloseTo(13.45, 1);
  });

  it("interpolates between months and signs correctly", () => {
    // Halfway between month 1 and 2 medians reads near zero using interpolated LMS.
    const m1 = lmsAt("wfa", "F", 30)!;
    const m2 = lmsAt("wfa", "F", 61)!;
    expect(m1.m).toBeLessThan(m2.m);
    const mid = scorePoint("2026-01-01", "F", "2026-02-15", 4.6, 55);
    expect(mid.z.wfa).not.toBeNull();
    const heavy = scorePoint("2026-01-01", "F", "2026-02-15", 8, 55);
    expect((heavy.z.wfa ?? 0) > (mid.z.wfa ?? 0)).toBe(true);
  });

  it("caps extreme scores instead of exploding", () => {
    const z = zScore("wfa", "M", 365, 30);
    expect(z).not.toBeNull();
    expect(Number.isFinite(z!)).toBe(true);
    expect(z!).toBeGreaterThan(3);
  });

  it("returns null outside 0–5 years and for missing measures", () => {
    const old = scorePoint("2018-01-01", "M", "2026-01-01", 20, 115);
    expect(old.z.wfa).toBeNull();
    expect(old.z.lhfa).toBeNull();
    const noH = scorePoint("2026-01-01", "F", "2026-03-01", 5, null);
    expect(noH.z.lhfa).toBeNull();
    expect(noH.z.bfa).toBeNull();
    expect(noH.z.wfa).not.toBeNull();
  });

  it("classifies bands at the cutoffs", () => {
    expect(bandOf(-3.5)).toBe("low3");
    expect(bandOf(-2.5)).toBe("low2");
    expect(bandOf(0)).toBe("ok");
    expect(bandOf(2.5)).toBe("high2");
    expect(bandOf(4)).toBe("high3");
    expect(bandOf(null)).toBeNull();
    expect(ageDaysBetween("2026-01-01", "2026-02-01")).toBe(31);
  });

  it("grows a scored history from recorded visits", async () => {
    const db = openTestDb();
    const app = buildApp(db, pack);
    const h = await adminHeaders(db, app);
    const child = JSON.parse((await app.inject({ method: "POST", url: "/api/children", headers: h, payload: { familyName: "G", givenName: "G", birthDate: "2026-01-01", sex: "F" } })).body) as { id: string };
    recordEncounter(db, { childId: child.id, date: "2026-03-01", screening: "VACCINATE", weightKg: 5, heightCm: 58 }, { today: "2026-03-01" });
    const r = growthFor(db, { childId: child.id, birthDate: "2026-01-01", sex: "F" });
    expect(r.points).toHaveLength(1);
    expect(r.points[0].ageDays).toBe(59);
    expect(r.points[0].bmi).toBeCloseTo(14.87, 1);
    expect(r.points[0].z.wfa).not.toBeNull();
    db.close();
  });

  it("serves growth over HTTP with login only", async () => {
    const db = openTestDb();
    const app = buildApp(db, pack);
    expect((await app.inject({ method: "GET", url: "/api/children/x/growth" })).statusCode).toBe(401);
    const h = await adminHeaders(db, app);
    const child = JSON.parse((await app.inject({ method: "POST", url: "/api/children", headers: h, payload: { familyName: "G", givenName: "G", birthDate: "2026-01-01", sex: "F" } })).body) as { id: string };
    const res = await app.inject({ method: "GET", url: `/api/children/${child.id}/growth`, headers: h });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { points: unknown[]; refs: Record<string, { neg2: unknown[] }> };
    expect(body.points).toEqual([]);
    expect(body.refs.wfa.med).toHaveLength(61);
    db.close();
  });

  it("live preview matches the saved server score", () => {
    const t = tables as unknown as Record<string, Record<string, [number, number, number][]>>;
    const refs = {
      wfa: { neg2: [], med: [], pos2: [], lms: t.wfa.M },
      lhfa: { neg2: [], med: [], pos2: [], lms: t.lhfa.M },
      bfa: { neg2: [], med: [], pos2: [], lms: t.bfa.M },
    };
    const cases: [string, string, number | null, number | null][] = [
      ["2026-01-01", "2026-01-01", 3.3464, 49.9],
      ["2026-01-01", "2026-07-01", 7.8, 66],
      ["2026-01-01", "2027-06-15", 11.2, 80.5],
      ["2026-01-01", "2026-04-01", 5, null],
    ];
    for (const [birth, date, w, h] of cases) {
      const saved = scorePoint(birth, "M", date, w, h);
      const live = scoreLive(refs, "M", birth, date, w, h)!;
      for (const ind of ["wfa", "lhfa", "bfa"] as const) {
        const a = saved.z[ind];
        const b = live[ind].z;
        if (a === null || b === null) {
          expect(b).toBe(a);
        } else {
          expect(Math.abs(a - b)).toBeLessThan(1e-9);
        }
      }
      expect(live.wfa.band).toBe(bandOf(saved.z.wfa));
    }
  });
});

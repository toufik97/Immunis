import { expect } from "vitest";
import { loadSchedulePack } from "../src/loader";
import { evaluatePatient, type EngineResult } from "../src/engine";
import type { ImmunizationRecord, Patient } from "../src/types";

export const pack = loadSchedulePack("MA");

export function rec(
  administeredOn: string,
  productGroupId: string,
  overridden = false
): ImmunizationRecord {
  return { administeredOn, productGroupId, overridden };
}

export function run(
  birthDate: string,
  history: ImmunizationRecord[],
  evaluationDate: string,
  projection: "next" | "full" = "next"
): EngineResult {
  return evaluatePatient(
    { birthDate } as Patient,
    history,
    pack,
    new Date(`${evaluationDate}T00:00:00`),
    { projection }
  );
}

export function doses(result: EngineResult, counter: string) {
  return result.doseValidations[counter]?.doses ?? [];
}

export function count(result: EngineResult, counter: string): number {
  return result.doseCounts[counter] ?? 0;
}

export function need(result: EngineResult, programId: string) {
  return result.antigenNeeds.find(n => n.programId === programId)!;
}

// STRICT: exact product list. Use only when the exact composition IS the
// thing under test (product-selection rules).
export function expectVisit(
  result: EngineResult,
  index: number,
  date: string,
  products: string[],
  status?: string
) {
  const v = result.visitPlan.visits[index];
  expect(v, `visit ${index + 1} missing`).toBeDefined();
  expect(v.date).toBe(date);
  expect([...v.products].sort()).toEqual([...products].sort());
  if (status) expect(v.status).toBe(status);
}

// RESILIENT: asserts required products are present (and forbidden ones
// absent) without caring what ELSE the visit contains. Survives new programs.
export function expectVisitContains(
  result: EngineResult,
  index: number,
  required: string[],
  opts: { date?: string; status?: string; forbidden?: string[] } = {}
) {
  const v = result.visitPlan.visits[index];
  expect(v, `visit ${index + 1} missing`).toBeDefined();
  if (opts.date) expect(v.date).toBe(opts.date);
  if (opts.status) expect(v.status).toBe(opts.status);
  for (const p of required) {
    expect(v.products, `visit ${index + 1} should contain ${p}`).toContain(p);
  }
  for (const p of opts.forbidden ?? []) {
    expect(v.products, `visit ${index + 1} must not contain ${p}`).not.toContain(p);
  }
}

// RESILIENT: finds a visit by date and asserts required products present.
export function expectVisitOnDateContains(
  result: EngineResult,
  date: string,
  required: string[],
  status?: string
) {
  const v = result.visitPlan.visits.find(x => x.date === date);
  expect(v, `no visit planned on ${date}`).toBeDefined();
  if (status) expect(v!.status).toBe(status);
  for (const p of required) {
    expect(v!.products, `visit on ${date} should contain ${p}`).toContain(p);
  }
}
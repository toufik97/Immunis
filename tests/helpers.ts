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
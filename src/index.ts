import { ageInMonthsAt, parseDate } from "./dates";
import { evaluateDtpDoses } from "./dtp-validity";
import { loadDtpPolicy } from "./load-dtp-policy";
import { selectDtpCatchupRuleFromPolicy } from "./rule-matcher";
import { buildDtpPlan } from "./dtp-plan";

import type { ImmunizationRecord, Patient } from "./types";

const patient: Patient = {
  birthDate: "2026-01-01"
};

const evaluationDate = parseDate("2026-09-04");

/**
 * Test history:
 *
 * First Penta dose is too early:
 * Birth: 2025-01-01
 * Penta: 2025-02-01
 * Age at dose: 1 month
 * Expected: INVALID
 *
 * Second Penta dose is valid:
 * Penta: 2025-03-01
 * Age at dose: 2 months
 * Expected: VALID as dose 1
 */
const history: ImmunizationRecord[] = [];

const policy = loadDtpPolicy();

const doseResults = evaluateDtpDoses(history, patient.birthDate);

const validDoseResults = doseResults.filter((dose) => dose.valid);

const validDoses = validDoseResults.length;

const validDoseDates = validDoseResults.map(
  (dose) => dose.administeredOn
);

const lastValidDoseDate =
  validDoseDates.length > 0
    ? validDoseDates[validDoseDates.length - 1]
    : null;

const ageMonths = ageInMonthsAt(patient.birthDate, evaluationDate);

const rule = selectDtpCatchupRuleFromPolicy(
  policy.catchup_rules,
  ageMonths,
  validDoses
);

const plan = buildDtpPlan(rule, {
  birthDate: patient.birthDate,
  evaluationDate,
  lastValidDoseDate
});

console.log("Morocco DTP engine prototype - Protocol scheduler");
console.log("-------------------------------------------------");
console.log("Loaded policy:", policy.program.id);
console.log("Catch-up rules loaded:", policy.catchup_rules.length);
console.log();

console.log("Patient age in months:", ageMonths);
console.log();

console.log("Dose validity results:");

for (const dose of doseResults) {
  console.log(dose);
}

console.log();
console.log("Valid DTP-containing doses:", validDoses);
console.log("Last valid dose date:", lastValidDoseDate);
console.log();

console.log("Selected catch-up rule:");
console.log(rule);
console.log();

console.log("DTP visit plan:");

for (const visit of plan.visits) {
  console.log(visit);
}

if (plan.warnings.length > 0) {
  console.log();
  console.log("Warnings:");

  for (const warning of plan.warnings) {
    console.log("-", warning);
  }
}
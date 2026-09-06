import { ageInMonthsAt } from "./dates";
import { evaluateDtpDoses } from "./dtp-validity";
import { loadDtpPolicy } from "./load-dtp-policy";
import { selectDtpCatchupRuleFromPolicy } from "./rule-matcher";

import type { ImmunizationRecord, Patient } from "./types";

const patient: Patient = {
  birthDate: "2025-01-01"
};

const evaluationDate = new Date("2026-09-04");

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
const history: ImmunizationRecord[] = [
  {
    administeredOn: "2025-02-01",
    productGroupId: "PENTA"
  },
  {
    administeredOn: "2025-03-01",
    productGroupId: "PENTA"
  }
];

const policy = loadDtpPolicy();

const doseResults = evaluateDtpDoses(history, patient.birthDate);

const validDoses = doseResults.filter((dose) => dose.valid).length;

const ageMonths = ageInMonthsAt(patient.birthDate, evaluationDate);

const rule = selectDtpCatchupRuleFromPolicy(
  policy.catchup_rules,
  ageMonths,
  validDoses
);

console.log("Morocco DTP engine prototype - YAML policy");
console.log("-------------------------------------------");
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
console.log();
console.log("Selected catch-up rule:");
console.log(rule);
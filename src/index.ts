import { ageInMonthsAt, parseDate } from "./dates";
import { evaluateDtpDoses } from "./dtp-validity";
import { loadSchedulePack } from "./load-schedule-pack";
import { selectDtpCatchupRuleFromPolicy } from "./rule-matcher";
import { buildDtpPlan } from "./dtp-plan";

import type { ImmunizationRecord, Patient } from "./types";

const patient: Patient = {
  birthDate: "2025-01-01"
};

const evaluationDate = parseDate("2026-09-04");

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

// Load the full schedule pack
const pack = loadSchedulePack("MA");

const doseResults = evaluateDtpDoses(history, patient.birthDate);
const validDoseResults = doseResults.filter((dose) => dose.valid);
const validDoses = validDoseResults.length;

const validDoseDates = validDoseResults.map((dose) => dose.administeredOn);
const lastValidDoseDate = validDoseDates.length > 0 ? validDoseDates[validDoseDates.length - 1] : null;

const ageMonths = ageInMonthsAt(patient.birthDate, evaluationDate);

// Select rule from the new pack structure
const rule = selectDtpCatchupRuleFromPolicy(
  pack.programs.dtp.catchup_rules,
  ageMonths,
  validDoses
);

// Build plan using protocols and boosters from the pack
const plan = buildDtpPlan(
  rule,
  {
    birthDate: patient.birthDate,
    evaluationDate,
    lastValidDoseDate
  },
  pack.programs.dtp.protocols,
  pack.programs.dtp.booster_policies
);

console.log("Morocco DTP engine prototype - Full Schedule Pack Integration");
console.log("-------------------------------------------------------------");
console.log("Loaded pack:", pack.catalog.meta.pack_id, "v" + pack.catalog.meta.version);
console.log("Patient age in months:", ageMonths);
console.log("Valid DTP-containing doses:", validDoses);
console.log("Last valid dose date:", lastValidDoseDate);
console.log();
console.log(`Selected catch-up rule: ${rule.id} (${rule.label_fr})`);
console.log();
console.log("DTP visit plan:");

for (const visit of plan.visits) {
  console.log(`Visit ${visit.visit}: ${visit.date} - ${visit.productGroupId} (${visit.role}) [${visit.status}]`);
}

if (plan.warnings.length > 0) {
  console.log("\nWarnings:");
  for (const warning of plan.warnings) {
    console.log("-", warning);
  }
}
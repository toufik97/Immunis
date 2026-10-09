import { loadSchedulePack } from "./loader";
import { evaluatePatient } from "./engine";
import { parseDate } from "./engine/duration";

console.log("=== Immunis ===\n");

const pack = loadSchedulePack("MA");

console.log(`Loaded country pack: ${(pack.catalog as any).meta?.country}`);
console.log(`Programs: ${Object.keys(pack.programs).join(", ")}\n`);

// Test 1
console.log("=== Test 1: 24-month-old, 0 previous doses ===\n");

const patient1 = { birthDate: "2024-04-01" };
const history1: any[] = [];
const evaluationDate1 = parseDate("2026-04-01");

const result1 = evaluatePatient(patient1, history1, pack, evaluationDate1);
displayResult(result1);

// Test 2
console.log("\n=== Test 2: 3-year-old, 3 previous Penta doses ===\n");

const patient2 = { birthDate: "2023-04-01" };
const history2: any[] = [
  { administeredOn: "2023-06-01", productGroupId: "PENTA" },
  { administeredOn: "2023-07-01", productGroupId: "PENTA" },
  { administeredOn: "2023-08-01", productGroupId: "PENTA" }
];
const evaluationDate2 = parseDate("2026-04-01");

const result2 = evaluatePatient(patient2, history2, pack, evaluationDate2);
displayResult(result2);

// Test 3
console.log("\n=== Test 3: 4-month-old, one too-early dose ===\n");

const patient3 = { birthDate: "2025-12-01" };
const history3: any[] = [
  { administeredOn: "2026-01-01", productGroupId: "PENTA" },
  { administeredOn: "2026-02-01", productGroupId: "PENTA" }
];
const evaluationDate3 = parseDate("2026-04-01");

const result3 = evaluatePatient(patient3, history3, pack, evaluationDate3);
displayResult(result3);

function displayResult(result: any) {
  console.log("Dose counts:");

  for (const [counterId, count] of Object.entries(result.doseCounts)) {
    if ((count as number) > 0) {
      console.log(`  ${counterId}: ${count}`);
    }
  }

  console.log("\nDose validity:");

  for (const [counterId, validation] of Object.entries(result.doseValidations)) {
    const v = validation as any;

    if (!v.doses || v.doses.length === 0) {
      continue;
    }

    console.log(`  ${counterId}:`);

    for (const dose of v.doses) {
      const status = dose.valid ? "VALID" : "INVALID";

      console.log(`    Dose ${dose.doseNumber}: ${dose.administeredOn} → ${status}`);

      if (dose.reasons.length > 0) {
        console.log(`      Reasons: ${dose.reasons.join(", ")}`);
      }
    }
  }

  console.log("\nAntigen needs:");

  for (const need of result.antigenNeeds) {
    console.log(`  ${need.programId}:`);
    console.log(`    Status: ${need.status}`);
    console.log(`    Valid doses received: ${need.validDosesReceived}`);
    console.log(`    Doses needed: ${need.dosesNeeded}`);

    if (need.matchedRuleId) {
      console.log(`    Matched rule: ${need.matchedRuleId}`);
    }

    if (need.warnings.length > 0) {
      console.log(`    Warnings: ${need.warnings.join("; ")}`);
    }
  }

  console.log("\nProduct selection:");
  console.log(`  Strategy: ${result.productSelection.strategy}`);

  for (const reason of result.productSelection.reasoning) {
    console.log(`  → ${reason}`);
  }

  for (const warning of result.productSelection.warnings) {
    console.log(`  ⚠ ${warning}`);
  }

  console.log("\nVisit plan:");

  if (result.visitPlan.visits.length === 0) {
    console.log("  No visits planned.");
  }

  for (const visit of result.visitPlan.visits) {
    console.log(`  Visit ${visit.visitNumber}: ${visit.date} [${visit.role}]`);
    console.log(`    Products: ${visit.products.join(", ")}`);
    console.log(`    Antigens: ${visit.antigensCovered.join(", ")}`);
    console.log(`    Status: ${visit.status}`);
  }

  for (const warning of result.visitPlan.warnings) {
    console.log(`  ⚠ ${warning}`);
  }
}

console.log("\n=== Engine evaluation complete ===");
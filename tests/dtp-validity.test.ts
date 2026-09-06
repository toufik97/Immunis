import { describe, it, expect } from "vitest";
import { evaluateDtpDoses } from "../src/dtp-validity";
import { loadSchedulePack } from "../src/load-schedule-pack";

const pack = loadSchedulePack("MA");
const validity = pack.programs.dtp.validity;

describe("DTP Dose Validity", () => {
  const birthDate = "2025-01-01";

  it("should mark dose 1 as valid if given at 2 months", () => {
    const history = [
      { administeredOn: "2025-03-01", productGroupId: "PENTA" as const }
    ];
    const results = evaluateDtpDoses(history, birthDate, validity);
    
    expect(results[0].valid).toBe(true);
    expect(results[0].doseNumber).toBe(1);
  });

  it("should mark dose 1 as invalid if given too early (1 month)", () => {
    const history = [
      { administeredOn: "2025-02-01", productGroupId: "PENTA" as const }
    ];
    const results = evaluateDtpDoses(history, birthDate, validity);
    
    expect(results[0].valid).toBe(false);
    expect(results[0].reasons).toContain("INVALID_AGE_DOSE_1_TOO_EARLY");
  });

  it("should count valid doses correctly when an early dose is invalid", () => {
    const history = [
      { administeredOn: "2025-02-01", productGroupId: "PENTA" as const }, // Invalid (too early)
      { administeredOn: "2025-03-01", productGroupId: "PENTA" as const }  // Valid (becomes dose 1)
    ];
    const results = evaluateDtpDoses(history, birthDate, validity);
    
    const validDoses = results.filter((r) => r.valid).length;
    expect(validDoses).toBe(1);
    
    // The second record should be labeled as doseNumber 1 because the first was invalid
    expect(results[1].doseNumber).toBe(1);
    expect(results[1].valid).toBe(true);
  });

  it("should mark dose 2 as invalid if interval is less than 28 days", () => {
    const history = [
      { administeredOn: "2025-03-01", productGroupId: "PENTA" as const },
      { administeredOn: "2025-03-15", productGroupId: "PENTA" as const } // Only 14 days later
    ];
    const results = evaluateDtpDoses(history, birthDate, validity);
    
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
    expect(results[1].reasons).toContain("INVALID_INTERVAL_BEFORE_DOSE_2");
  });
});
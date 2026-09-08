export interface Patient {
  birthDate: string;
}

export interface ImmunizationRecord {
  administeredOn: string;
  productGroupId: string;
  overridden?: boolean;
}

export type ProgramStatus =
  | "NEEDS_PRIMARY"
  | "NEEDS_BOOSTER"
  | "COMPLETE"
  | "NOT_NEEDED";

export interface AntigenNeed {
  programId: string;
  antigenTargets: string[];
  counterId: string;
  validDosesReceived: number;
  dosesNeeded: number;
  status: ProgramStatus;
  matchedRuleId: string | null;
  action: string | null;
  boosterSequence: number | null;
  boosterPolicyId: string | null;
  warnings: string[];
}

export interface SlotProduct {
  productGroupId: string;
  coveredProgramIds: string[];
}

export interface PrimarySlotPlan {
  slot: number;
  products: SlotProduct[];
}

export interface BoosterPlan {
  programId: string;
  productGroupId: string;
  boosterSequence: number;
  role: string;
}

export interface ProductSelectionResult {
  primarySlots: PrimarySlotPlan[];
  boosterPlans: BoosterPlan[];
  reasoning: string[];
  warnings: string[];
  strategy: string;
}

export interface PlannedVisit {
  visitNumber: number;
  date: string;
  products: string[];
  antigensCovered: string[];
  role: string;
  status: "DUE_NOW" | "DUE_FUTURE";
}

export interface VisitPlan {
  visits: PlannedVisit[];
  warnings: string[];
}

export interface DoseCounts {
  [counterId: string]: number;
}
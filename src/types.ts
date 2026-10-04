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
  targetProduct?: string | null;   // <-- ADD THIS LINE
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
  birthDosePlans: BirthDosePlan[];
}

export type VisitStatus = "DUE_NOW" | "DUE_FUTURE" | "PROJECTED";

export interface PlannedVisit {
  visitNumber: number;
  date: string;
  products: string[];
  antigensCovered: string[];
  role: string;
  status: VisitStatus;
}

export interface EvaluateOptions {
  projection?: "next" | "full";
  availability?: AvailabilityInput;
}

export interface VisitPlan {
  visits: PlannedVisit[];
  warnings: string[];
}

export interface DoseCounts {
  [counterId: string]: number;
}
export interface BirthDosePlan {
  programId: string;
  productGroupId: string;
  date: string;
  offset: number;
}

export interface AvailabilityInput {
  policy?: "TRANSITION" | "CONTINUITY_FIRST" | "STOCK_DRIVEN";
  products?: string[];
}

export interface SchemaResolution {
  programId: string;
  schemaId: string;
  requiredPrimaries: number;
  boosterCount: number;
  targetProduct: string | null;
  assumption: string | null;
}
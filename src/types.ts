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
  | "NOT_NEEDED"
  | "UNDETERMINED"; // no catch-up rule matched: the engine cannot say what is needed

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
  targetProduct?: string | null;
  /** primaries / boosters this product track requires (variant rules such as PCV) */
  requiredPrimaries?: number | null;
  boosterCount?: number | null;
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

export interface DoseAmount {
  value: number;
  unit: string; // e.g. "IU"
}

/** One dose inside a visit: which program it counts for, which dose number it is,
 *  and the prescribed amount when the schedule defines one (vitamins). */
export interface PlannedDose {
  programId: string;
  productGroupId: string;
  doseNumber: number;
  category: "vaccine" | "supplement";
  amount?: DoseAmount;
  /** true for a future booster shown only in a full projection */
  projected?: boolean;
}

export interface PlannedVisit {
  visitNumber: number;
  date: string;
  products: string[];
  antigensCovered: string[];
  role: string;
  status: VisitStatus;
  doses?: PlannedDose[];
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

export type WarningSeverity = "info" | "soft" | "blocking";

export interface WarningContext {
  programId?: string;
  counterId?: string;
  productGroupId?: string;
  doseNumber?: number;
  administeredOn?: string;
  date?: string;
}

export interface EngineWarning {
  /** stable machine code, e.g. "INVALID_AGE_TOO_EARLY" (no dose number in the code) */
  code: string;
  /** how the UI must treat it */
  severity: WarningSeverity;
  /** true = a healthcare pro may override with justification (audit); false = hard stop */
  overridable: boolean;
  context?: WarningContext;
  /** values for i18n templates, e.g. { ageMonths: 14, targetMonths: 18 } */
  params?: Record<string, string | number>;
  /** English fallback; the French catalogue is a UI/i18n concern */
  message_en: string;
}
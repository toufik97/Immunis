export type ProductGroupId =
  | "PENTA"
  | "DTC"
  | "TD"
  | "HB_MONO"
  | "BCG"
  | "VPO"
  | "VPI"
  | "PCV_PRIMOVAX"
  | "PCV_PREVENAR"
  | "ROTAVIRUS"
  | "RR"
  | "RRO"
  | "VAR"
  | "UNKNOWN";

export interface Patient {
  birthDate: string; // format: YYYY-MM-DD
}

export interface ImmunizationRecord {
  administeredOn: string; // format: YYYY-MM-DD
  productGroupId: ProductGroupId;
}

export type DtpAction =
  | { type: "start_protocol"; protocol: string }
  | { type: "schedule_future"; futureDose: "DTP_BOOSTER_1" | "DTP_BOOSTER_2" }
  | { type: "give_if_due"; dose: "DTP_BOOSTER_1" | "DTP_BOOSTER_2" }
  | { type: "complete" }
  | { type: "needs_review"; reason: string };

export type RuleConfidence =
  | "official"
  | "draft"
  | "needs_validation";

export interface DtpCatchupRule {
  id: string;
  labelFr: string;
  ageFromMonths?: number;
  ageToBeforeMonths?: number;
  validDosesEquals?: number;
  validDosesGte?: number;
  action: DtpAction;
  confidence: RuleConfidence;
}
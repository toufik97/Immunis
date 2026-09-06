import type { DtpCatchupRule, ImmunizationRecord } from "./types";

export const dtpCatchupRules: DtpCatchupRule[] = [
  {
    id: "MA-DTP-CU-0D-LT12M",
    labelFr: "0 dose, moins de 12 mois",
    ageToBeforeMonths: 12,
    validDosesEquals: 0,
    action: {
      type: "start_protocol",
      protocol: "DTP_PRIMARY_3_PENTA_4W"
    },
    confidence: "official"
  },
  {
    id: "MA-DTP-CU-0D-12M-LT3Y",
    labelFr: "0 dose, 12 mois à moins de 3 ans",
    ageFromMonths: 12,
    ageToBeforeMonths: 36,
    validDosesEquals: 0,
    action: {
      type: "start_protocol",
      protocol: "DTP_PRIMARY_2PENTA_1DTC_4W"
    },
    confidence: "official"
  },
  {
    id: "MA-DTP-CU-0D-3Y-LT7Y",
    labelFr: "0 dose, 3 ans à moins de 7 ans",
    ageFromMonths: 36,
    ageToBeforeMonths: 84,
    validDosesEquals: 0,
    action: {
      type: "start_protocol",
      protocol: "DTP_PRIMARY_3DTC"
    },
    confidence: "draft"
  },

  {
    id: "MA-DTP-CU-1D-LT18M",
    labelFr: "1 dose, moins de 18 mois",
    ageToBeforeMonths: 18,
    validDosesEquals: 1,
    action: {
      type: "start_protocol",
      protocol: "DTP_ADD_2_PENTA_4W"
    },
    confidence: "official"
  },
  {
    id: "MA-DTP-CU-1D-18M-LT3Y",
    labelFr: "1 dose, 18 mois à moins de 3 ans",
    ageFromMonths: 18,
    ageToBeforeMonths: 36,
    validDosesEquals: 1,
    action: {
      type: "start_protocol",
      protocol: "DTP_1PENTA_THEN_DTC_1M"
    },
    confidence: "official"
  },
  {
    id: "MA-DTP-CU-1D-3Y-LT7Y",
    labelFr: "1 dose, 3 ans à moins de 7 ans",
    ageFromMonths: 36,
    ageToBeforeMonths: 84,
    validDosesEquals: 1,
    action: {
      type: "start_protocol",
      protocol: "DTP_2DTC_1M"
    },
    confidence: "official"
  },

  {
    id: "MA-DTP-CU-2D-LT18M",
    labelFr: "2 doses, moins de 18 mois",
    ageToBeforeMonths: 18,
    validDosesEquals: 2,
    action: {
      type: "start_protocol",
      protocol: "DTP_ADD_1_PENTA"
    },
    confidence: "official"
  },
  {
    id: "MA-DTP-CU-2D-18M-LT3Y",
    labelFr: "2 doses, 18 mois à moins de 3 ans",
    ageFromMonths: 18,
    ageToBeforeMonths: 36,
    validDosesEquals: 2,
    action: {
      type: "start_protocol",
      protocol: "DTP_1PENTA_THEN_DTC_6M"
    },
    confidence: "official"
  },
  {
    id: "MA-DTP-CU-2D-3Y-LT7Y",
    labelFr: "2 doses, 3 ans à moins de 7 ans",
    ageFromMonths: 36,
    ageToBeforeMonths: 84,
    validDosesEquals: 2,
    action: {
      type: "start_protocol",
      protocol: "DTP_2DTC_6M"
    },
    confidence: "needs_validation"
  },

  {
    id: "MA-DTP-CU-3D-LT18M",
    labelFr: "3 doses, moins de 18 mois",
    ageToBeforeMonths: 18,
    validDosesEquals: 3,
    action: {
      type: "schedule_future",
      futureDose: "DTP_BOOSTER_1"
    },
    confidence: "draft"
  },
  {
    id: "MA-DTP-CU-3D-18M-LT7Y",
    labelFr: "3 doses, 18 mois à moins de 7 ans",
    ageFromMonths: 18,
    ageToBeforeMonths: 84,
    validDosesEquals: 3,
    action: {
      type: "give_if_due",
      dose: "DTP_BOOSTER_1"
    },
    confidence: "official"
  },

  {
    id: "MA-DTP-CU-4D-LT5Y",
    labelFr: "4 doses, moins de 5 ans",
    ageToBeforeMonths: 60,
    validDosesEquals: 4,
    action: {
      type: "schedule_future",
      futureDose: "DTP_BOOSTER_2"
    },
    confidence: "needs_validation"
  },
  {
    id: "MA-DTP-CU-4D-5Y-LT7Y",
    labelFr: "4 doses, 5 ans à moins de 7 ans",
    ageFromMonths: 60,
    ageToBeforeMonths: 84,
    validDosesEquals: 4,
    action: {
      type: "give_if_due",
      dose: "DTP_BOOSTER_2"
    },
    confidence: "official"
  },

  {
    id: "MA-DTP-CU-5D-LT7Y",
    labelFr: "5 doses ou plus, moins de 7 ans",
    ageToBeforeMonths: 84,
    validDosesGte: 5,
    action: {
      type: "complete"
    },
    confidence: "official"
  }
];

export function countValidDtpContainingDoses(
  records: ImmunizationRecord[]
): number {
  return records.filter(
    (record) =>
      record.productGroupId === "PENTA" ||
      record.productGroupId === "DTC"
  ).length;
}

export function selectDtpCatchupRule(
  ageMonths: number,
  validDoses: number
): DtpCatchupRule {
  const rule = dtpCatchupRules.find((r) => {
    const ageOk =
      (r.ageFromMonths === undefined || ageMonths >= r.ageFromMonths) &&
      (r.ageToBeforeMonths === undefined || ageMonths < r.ageToBeforeMonths);

    let doseOk = false;

    if (r.validDosesEquals !== undefined) {
      doseOk = validDoses === r.validDosesEquals;
    } else if (r.validDosesGte !== undefined) {
      doseOk = validDoses >= r.validDosesGte;
    }

    return ageOk && doseOk;
  });

  if (!rule) {
    return {
      id: "MA-DTP-CU-FALLBACK",
      labelFr: "Cas DTP non couvert",
      action: {
        type: "needs_review",
        reason: "No matching DTP catch-up rule"
      },
      confidence: "needs_validation"
    };
  }

  return rule;
}
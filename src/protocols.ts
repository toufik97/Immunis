import type { ProductGroupId } from "./types";

export type DoseRole =
  | "primary"
  | "primary_completion"
  | "booster_1"
  | "booster_2";

export type ProtocolConfidence =
  | "official"
  | "draft"
  | "needs_validation";

export interface ProtocolDuration {
  weeks?: number;
  months?: number;
}

export interface ProtocolStep {
  seq: number;
  productGroupId: ProductGroupId;
  role: DoseRole;
  labelFr: string;
  minInterval?: ProtocolDuration;
}

export interface ProtocolDefinition {
  id: string;
  labelFr: string;
  confidence?: ProtocolConfidence;
  steps: ProtocolStep[];
}

export const dtpProtocols: Record<string, ProtocolDefinition> = {
  DTP_PRIMARY_3_PENTA_4W: {
    id: "DTP_PRIMARY_3_PENTA_4W",
    labelFr: "3 doses Penta à 4 semaines d'intervalle",
    confidence: "official",
    steps: [
      {
        seq: 1,
        productGroupId: "PENTA",
        role: "primary",
        labelFr: "Penta"
      },
      {
        seq: 2,
        productGroupId: "PENTA",
        role: "primary",
        labelFr: "Penta",
        minInterval: {
          weeks: 4
        }
      },
      {
        seq: 3,
        productGroupId: "PENTA",
        role: "primary_completion",
        labelFr: "Penta",
        minInterval: {
          weeks: 4
        }
      }
    ]
  },

  DTP_PRIMARY_2PENTA_1DTC_4W: {
    id: "DTP_PRIMARY_2PENTA_1DTC_4W",
    labelFr: "2 doses Penta + 1 dose DTC à 4 semaines d'intervalle",
    confidence: "official",
    steps: [
      {
        seq: 1,
        productGroupId: "PENTA",
        role: "primary",
        labelFr: "Penta"
      },
      {
        seq: 2,
        productGroupId: "PENTA",
        role: "primary",
        labelFr: "Penta",
        minInterval: {
          weeks: 4
        }
      },
      {
        seq: 3,
        productGroupId: "DTC",
        role: "primary_completion",
        labelFr: "DTC",
        minInterval: {
          weeks: 4
        }
      }
    ]
  },

  DTP_PRIMARY_3DTC: {
    id: "DTP_PRIMARY_3DTC",
    labelFr: "3 doses DTC",
    confidence: "draft",
    steps: [
      {
        seq: 1,
        productGroupId: "DTC",
        role: "primary",
        labelFr: "DTC"
      },
      {
        seq: 2,
        productGroupId: "DTC",
        role: "primary",
        labelFr: "DTC",
        minInterval: {
          weeks: 4
        }
      },
      {
        seq: 3,
        productGroupId: "DTC",
        role: "primary_completion",
        labelFr: "DTC",
        minInterval: {
          months: 6
        }
      }
    ]
  },

  DTP_ADD_2_PENTA_4W: {
    id: "DTP_ADD_2_PENTA_4W",
    labelFr: "Ajouter 2 doses Penta à 4 semaines d'intervalle",
    confidence: "official",
    steps: [
      {
        seq: 1,
        productGroupId: "PENTA",
        role: "primary",
        labelFr: "Penta"
      },
      {
        seq: 2,
        productGroupId: "PENTA",
        role: "primary_completion",
        labelFr: "Penta",
        minInterval: {
          weeks: 4
        }
      }
    ]
  },

  DTP_ADD_1_PENTA: {
    id: "DTP_ADD_1_PENTA",
    labelFr: "Ajouter 1 dose Penta",
    confidence: "official",
    steps: [
      {
        seq: 1,
        productGroupId: "PENTA",
        role: "primary_completion",
        labelFr: "Penta"
      }
    ]
  },

  DTP_1PENTA_THEN_DTC_1M: {
    id: "DTP_1PENTA_THEN_DTC_1M",
    labelFr: "1 Penta puis 1 DTC un mois plus tard",
    confidence: "official",
    steps: [
      {
        seq: 1,
        productGroupId: "PENTA",
        role: "primary",
        labelFr: "Penta"
      },
      {
        seq: 2,
        productGroupId: "DTC",
        role: "primary_completion",
        labelFr: "DTC",
        minInterval: {
          months: 1
        }
      }
    ]
  },

  DTP_1PENTA_THEN_DTC_6M: {
    id: "DTP_1PENTA_THEN_DTC_6M",
    labelFr: "1 Penta puis 1 DTC six mois plus tard",
    confidence: "official",
    steps: [
      {
        seq: 1,
        productGroupId: "PENTA",
        role: "primary_completion",
        labelFr: "Penta"
      },
      {
        seq: 2,
        productGroupId: "DTC",
        role: "booster_1",
        labelFr: "DTC rappel 1",
        minInterval: {
          months: 6
        }
      }
    ]
  },

  DTP_2DTC_1M: {
    id: "DTP_2DTC_1M",
    labelFr: "2 doses DTC à un mois d'intervalle",
    confidence: "official",
    steps: [
      {
        seq: 1,
        productGroupId: "DTC",
        role: "primary",
        labelFr: "DTC"
      },
      {
        seq: 2,
        productGroupId: "DTC",
        role: "primary_completion",
        labelFr: "DTC",
        minInterval: {
          months: 1
        }
      }
    ]
  },

  DTP_2DTC_6M: {
    id: "DTP_2DTC_6M",
    labelFr: "2 doses DTC à six mois d'intervalle",
    confidence: "needs_validation",
    steps: [
      {
        seq: 1,
        productGroupId: "DTC",
        role: "primary_completion",
        labelFr: "DTC"
      },
      {
        seq: 2,
        productGroupId: "DTC",
        role: "booster_1",
        labelFr: "DTC rappel 1",
        minInterval: {
          months: 6
        }
      }
    ]
  }
};
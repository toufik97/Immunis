import type { EngineWarning, WarningSeverity } from "../types";

/**
 * Single source of truth for how the UI must treat each warning.
 * The engine emits stable codes; severity + overridability live here so the
 * UI can render soft notices, block input, or offer a justified override.
 */
export const WARNING_DEFS: Record<string, { severity: WarningSeverity; overridable: boolean }> = {
  // ---- dose-entry BLOCKING (UI blocks the dose; overridable ones allow a justified override)
  INVALID_AGE_TOO_EARLY:             { severity: "blocking", overridable: true  },
  INVALID_AGE_TOO_LATE:              { severity: "blocking", overridable: false }, // hard stop (e.g. Rota 24m)
  INVALID_INTERVAL:                  { severity: "blocking", overridable: true  },
  DUPLICATE_SAME_DAY:                { severity: "blocking", overridable: false }, // data error, never waivable

  // ---- counted-with-warning (dose still counts; show a soft notice)
  EARLY_DOSE_COUNTED:                { severity: "soft", overridable: false },
  EARLY_BOOSTER_COUNTED:             { severity: "soft", overridable: false },
  SHORT_BOOSTER_INTERVAL_COUNTED:    { severity: "soft", overridable: false },
  DOSE_CAP_EXCEEDED_COUNTED:         { severity: "soft", overridable: false },

  // ---- program / planning
  NO_MATCHING_RULE:                  { severity: "soft", overridable: false },
  UNKNOWN_ACTION:                    { severity: "soft", overridable: false },
  DOSE_CAP_REACHED_PLANNING_STOPPED: { severity: "info", overridable: false },
  AGE_LIMIT_PREVENTS_DOSE:           { severity: "soft", overridable: false },
  NO_ELIGIBLE_PRODUCT_AT_DATE:       { severity: "soft", overridable: false },
  PRODUCT_SUBSTITUTED_BY_AGE:        { severity: "info", overridable: false },
  DUPLICATE_DOSE_SAME_DAY:           { severity: "soft", overridable: false },
  UNKNOWN_PRODUCT_IN_HISTORY:        { severity: "soft", overridable: false },
  SPACING_NOT_CONVERGED:             { severity: "soft", overridable: false },

  // ---- info / explanations
  SPACING_SHIFT:                     { severity: "info", overridable: false },
  LIVE_SPACING_SHIFT:                { severity: "info", overridable: false },
  CASCADE_REPLAN:                    { severity: "info", overridable: false },
  OVERRIDDEN_BY_PROFESSIONAL:        { severity: "info", overridable: false }
};

// Codes the engine emits with an embedded dose/booster number → stable base code.
const NUMBERED_PATTERNS: Array<[RegExp, string]> = [
  [/^INVALID_AGE_DOSE_\d+_TOO_EARLY$/, "INVALID_AGE_TOO_EARLY"],
  [/^INVALID_AGE_DOSE_\d+_TOO_LATE$/, "INVALID_AGE_TOO_LATE"],
  [/^INVALID_INTERVAL_BEFORE_DOSE_\d+$/, "INVALID_INTERVAL"],
  [/^EARLY_DOSE_\d+_COUNTED$/, "EARLY_DOSE_COUNTED"],
  [/^EARLY_BOOSTER_\d+_COUNTED$/, "EARLY_BOOSTER_COUNTED"],
  [/^SHORT_BOOSTER_\d+_INTERVAL_COUNTED$/, "SHORT_BOOSTER_INTERVAL_COUNTED"],
  [/^OVERRIDDEN_BY_HEALTHCARE_PROFESSIONAL$/, "OVERRIDDEN_BY_PROFESSIONAL"]
];

export function normalizeCode(code: string): string {
  for (const [re, base] of NUMBERED_PATTERNS) {
    if (re.test(code)) return base;
  }
  return code;
}

/**
 * Turn an engine warning string ("CODE: prose" or a bare code) into a
 * structured EngineWarning the UI can act on.
 */
export function toStructured(raw: string): EngineWarning {
  const trimmed = raw.trim();
  const colonIdx = trimmed.indexOf(":");
  const candidate = colonIdx === -1 ? trimmed : trimmed.slice(0, colonIdx).trim();
  const looksLikeCode = /^[A-Z][A-Z0-9_]*$/.test(candidate);
  const code = looksLikeCode ? normalizeCode(candidate) : "ENGINE_NOTICE";
  const def = WARNING_DEFS[code] ?? { severity: "soft" as WarningSeverity, overridable: false };
  return { code, severity: def.severity, overridable: def.overridable, message_en: trimmed };
}
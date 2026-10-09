import { z } from "zod";

/**
 * Dose origin — the central rule (spec §5.10).
 * Clinical engine reads ALL origins; analytics/stock read CENTRE only.
 * CAMPAIGN is reserved: not counted clinically in v1.
 */
export const DoseOriginSchema = z.enum(["CENTRE", "EXTERNAL", "CAMPAIGN"]);
export type DoseOrigin = z.infer<typeof DoseOriginSchema>;

/** Doses the clinical engine may use (everything except CAMPAIGN). */
export function isClinicallyCredited(origin: DoseOrigin): boolean {
  return origin === "CENTRE" || origin === "EXTERNAL";
}

/** Doses that consume stock and feed centre analytics. */
export function isCentreCounted(origin: DoseOrigin): boolean {
  return origin === "CENTRE";
}

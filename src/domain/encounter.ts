import { z } from "zod";
import { DoseOriginSchema } from "./dose-origin";

export const DoseRecordSchema = z.object({
  productGroupId: z.string().min(1),
  administeredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  origin: DoseOriginSchema,
  /** Required when origin is CENTRE (lot traceability, FR-4.3). */
  lotId: z.string().optional(),
  overridden: z.boolean().default(false),
  recordedBy: z.string().min(1),
});

export type DoseRecord = z.infer<typeof DoseRecordSchema>;

export const ScreeningResultSchema = z.enum(["VACCINATE", "DEFER", "CONTRAINDICATED"]);
export type ScreeningResult = z.infer<typeof ScreeningResultSchema>;

/**
 * One visit = one Encounter grouping screening + growth + doses + next appointment (FR-5.3).
 */
export const EncounterSchema = z.object({
  id: z.string().min(1),
  childId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  screening: ScreeningResultSchema,
  screeningNote: z.string().optional(),
  weightKg: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  doses: z.array(DoseRecordSchema).default([]),
  nextAppointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type Encounter = z.infer<typeof EncounterSchema>;

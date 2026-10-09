import { z } from "zod";

/** Justified override + append-only audit trail (spec §5.8). */
export const OverrideEntrySchema = z.object({
  id: z.string().min(1),
  childId: z.string().min(1),
  encounterId: z.string().optional(),
  author: z.string().min(1),
  what: z.string().min(1),
  reason: z.string().min(1),
  createdAt: z.string().min(1),
});

export type OverrideEntry = z.infer<typeof OverrideEntrySchema>;

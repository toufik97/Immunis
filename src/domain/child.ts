import { z } from "zod";

const LocalIdSchema = z.object({
  centreId: z.string().min(1),
  /** Local registry id in "xx/yy" format (xx = annual counter, yy = first-visit year). */
  value: z.string().regex(/^\d+\/\d{2,4}$/, "local id must look like xx/yy"),
});

/**
 * Child identity (spec §5.1).
 * Internal stable id is independent of per-centre annual xx/yy ids.
 * nationalId is a reserved placeholder for future merge.
 */
export const ChildSchema = z.object({
  id: z.string().min(1),
  familyName: z.string().min(1),
  givenName: z.string().min(1),
  /** Confirmation key before any clinical action (FR-1.2). */
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  parentNames: z.string().optional(),
  localIds: z.array(LocalIdSchema).default([]),
  nationalId: z.string().optional(),
});

export type Child = z.infer<typeof ChildSchema>;
export type LocalId = z.infer<typeof LocalIdSchema>;

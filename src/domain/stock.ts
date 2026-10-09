import { z } from "zod";

/** Stock is tracked per lot, not per product (spec §5.4). */
export const LotSchema = z.object({
  id: z.string().min(1),
  productGroupId: z.string().min(1),
  lotNumber: z.string().min(1),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coldChainOk: z.boolean(),
  qtyOnHand: z.number().int().nonnegative(),
});

export type Lot = z.infer<typeof LotSchema>;

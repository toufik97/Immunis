import { z } from "zod";

/**
 * Vaccination-workflow scheduling rules (operational only — never clinical).
 * A centre books appointments on (weekday × slot) cells; each cell holds a cap.
 * Scope "global" or a product-group id; per-group rows override global for that
 * group, other groups fall back to global. No rows at all = unconstrained
 * booking (today's behaviour). A cap of 0 closes the cell (e.g. Friday PM off).
 */

export const SlotSchema = z.enum(["AM", "PM"]);
export type Slot = z.infer<typeof SlotSchema>;

/** 0 = Sunday … 6 = Saturday (matches Date.getUTCDay on the civil date). */
export const WeekdaySchema = z.number().int().min(0).max(6);

export const SchedulingRuleSchema = z.object({
  scope: z.string().min(1),
  weekday: WeekdaySchema,
  slot: SlotSchema,
  cap: z.number().int().min(0),
});
export type SchedulingRule = z.infer<typeof SchedulingRuleSchema>;

export const ClosureSourceSchema = z.enum(["auto", "manual"]);
export type ClosureSource = z.infer<typeof ClosureSourceSchema>;

export const ClosureDateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().min(1),
  source: ClosureSourceSchema,
});
export type ClosureDate = z.infer<typeof ClosureDateSchema>;

/** One booking-time finding: code for logic, params for i18n sentences. */
export const SchedulingIssueSchema = z.object({
  code: z.enum(["closed_day", "slot_full", "closure_day", "beyond_horizon"]),
  productGroupId: z.string().min(1).nullable().default(null),
  booked: z.number().int().min(0).nullable().default(null),
  cap: z.number().int().min(0).nullable().default(null),
  limit: z.string().nullable().default(null),
});
export type SchedulingIssue = z.infer<typeof SchedulingIssueSchema>;

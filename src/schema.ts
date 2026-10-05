import { z } from "zod";

export const CatalogSchema = z
  .object({
    meta: z.any(),
    antigens: z.array(z.any()).default([]),
    product_groups: z.array(z.any()).default([])
  })
  .passthrough();

export const CountersSchema = z
  .object({
    counters: z.array(z.any()).default([])
  })
  .passthrough();

// ---- catch-up rules: strict, so a typo is an error at load time, not a silent change in behavior
const DurationSchema = z
  .object({
    days: z.number().optional(),
    weeks: z.number().optional(),
    months: z.number().optional(),
    years: z.number().optional(),
    birth: z.boolean().optional()
  })
  .strict();

const ProductHistoryCondition = z
  .object({
    equals: z.number().optional(),
    gte: z.number().optional(),
    lte: z.number().optional()
  })
  .strict();

const RuleWhenSchema = z
  .object({
    age: z
      .object({ from: DurationSchema.optional(), to_before: DurationSchema.optional() })
      .strict()
      .optional(),
    counter: z
      .object({
        id: z.string().optional(),
        equals: z.number().optional(),
        gte: z.number().optional()
      })
      .strict()
      .optional(),
    product_history: z.record(z.string(), ProductHistoryCondition).optional(),
    availability: z
      .object({ includes: z.string().optional(), excludes: z.string().optional() })
      .strict()
      .optional()
  })
  .strict();

export const RULE_ACTIONS = [
  "complete_primary",
  "complete_remaining",
  "schedule_booster",
  "give_booster_if_due",
  "complete",
  "none"
] as const;

const RuleThenSchema = z
  .object({
    action: z.enum(RULE_ACTIONS).optional(),
    doses_needed: z.number().optional(),
    booster_sequence: z.number().optional(),
    booster_policy: z.string().optional(),
    required_primaries: z.number().optional(),
    booster_count: z.number().optional(),
    target_product: z.string().optional()
  })
  .strict();

export const CatchupRuleSchema = z
  .object({
    id: z.string(),
    label_fr: z.string().optional(),
    when: RuleWhenSchema,
    then: RuleThenSchema,
    source: z.string().optional(),
    confidence: z.string().optional()
  })
  .strict();

export const ProgramSchema = z
  .object({
    program: z
      .object({
        id: z.string(),
        counter: z.string(),
        antigen_targets: z.array(z.string()).optional()
      })
      .passthrough(),

    primary_series: z.any().optional(),
    booster_policies: z.array(z.any()).optional(),
    catchup_rules: z.array(CatchupRuleSchema).optional(),
    review_flags: z.array(z.any()).optional()
  })
  .passthrough();

export const ProductSelectionSchema = z
  .object({
    product_selection: z.any()
  })
  .passthrough();

export type Catalog = z.infer<typeof CatalogSchema>;
export type Counters = z.infer<typeof CountersSchema>;
export type Program = z.infer<typeof ProgramSchema>;
export type ProductSelection = z.infer<typeof ProductSelectionSchema>;
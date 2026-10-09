import { z } from "zod";

// ---- catch-up rules: strict, so a typo is an error at load time, not a silent change in behavior
export const DurationSchema = z
  .object({
    days: z.number().nonnegative().optional(),
    weeks: z.number().nonnegative().optional(),
    months: z.number().nonnegative().optional(),
    years: z.number().nonnegative().optional(),
    birth: z.boolean().optional(),
    exclusive: z.boolean().optional()
  })
  .strict()
  .refine(o => Object.keys(o).length > 0, "empty duration");

export const AntigenSchema = z
  .object({
    id: z.string().min(1),
    label_fr: z.string().optional(),
    kind: z.string().optional()
  })
  .passthrough();

export const ProductGroupSchema = z
  .object({
    id: z.string().min(1),
    label_fr: z.string().optional(),
    satisfies_antigens: z.array(z.string().min(1)).default([]),
    category: z.enum(["vaccine", "supplement"]).optional(),
    aliases: z.array(z.string().min(1)).optional(),
    clinical: z
      .object({
        live: z.boolean().optional(),
        availability: z.string().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

export const CounterDefSchema = z
  .object({
    id: z.string().min(1),
    label_fr: z.string().optional(),
    description_fr: z.string().optional(),
    counts_product_groups: z.array(z.string().min(1)),
    only_valid_doses: z.boolean().optional(),
    confidence: z.string().optional(),
    product_history_aware: z.boolean().optional()
  })
  .passthrough();

export const CatalogSchema = z
  .object({
    meta: z.any(),
    antigens: z.array(AntigenSchema).default([]),
    product_groups: z.array(ProductGroupSchema).default([])
  })
  .passthrough();

export const CountersSchema = z
  .object({
    counters: z.array(CounterDefSchema).default([])
  })
  .passthrough();

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

export const ConditionalIntervalSchema = z
  .object({
    conditional: z
      .array(
        z
          .object({
            when: z
              .object({
                age_at_previous_dose: z
                  .object({
                    from: DurationSchema.optional(),
                    to_before: DurationSchema.optional()
                  })
                  .strict()
              })
              .strict()
              .passthrough(),
            interval: DurationSchema
          })
          .passthrough()
      )
      .min(1)
  })
  .strict();

const IntervalSchema = z.union([DurationSchema, ConditionalIntervalSchema]);

export const DoseValidityRuleSchema = z
  .object({
    dose: z.number().int().positive(),
    product_group: z.string().min(1).optional(),
    min_age: DurationSchema.optional(),
    max_age: DurationSchema.optional(),
    target_min_age: DurationSchema.optional(),
    min_interval_from_previous: IntervalSchema.optional(),
    dose_amount: z
      .object({
        value: z.number().positive(),
        unit: z.string().min(1)
      })
      .strict()
      .optional()
  })
  .passthrough();

export const PrimarySeriesSchema = z
  .object({
    required_valid_doses: z.number().int().nonnegative().optional(),
    booster_policy: z.string().min(1).optional(),
    preferred_product: z.string().min(1).optional(),
    birth_dose: z
      .object({
        product_group: z.string().min(1),
        counts_as_dose: z.number().int().nonnegative().optional(),
        plan_if_age_below: DurationSchema.optional()
      })
      .passthrough()
      .optional(),
    dose_zero: z
      .object({
        product_groups: z.array(z.string().min(1)),
        max_age: DurationSchema
      })
      .passthrough()
      .optional(),
    dose_validity: z.array(DoseValidityRuleSchema).optional()
  })
  .passthrough();

export const BoosterConditionalProductSchema = z
  .object({
    conditional: z
      .array(
        z
          .object({
            when: z
              .object({
                age_at_dose: z
                  .object({
                    from: DurationSchema.optional(),
                    to_before: DurationSchema.optional()
                  })
                  .strict()
              })
              .strict()
              .passthrough(),
            product: z.string().min(1)
          })
          .passthrough()
      )
      .min(1)
  })
  .strict();

export const BoosterConfigSchema = z
  .object({
    product_group: z.union([z.string().min(1), BoosterConditionalProductSchema]),
    min_age: DurationSchema.optional(),
    min_interval_after_primary_completion: IntervalSchema.optional(),
    min_interval_after_booster_1: IntervalSchema.optional(),
    min_interval_after_booster_2: IntervalSchema.optional(),
    min_interval_after_booster_3: IntervalSchema.optional()
  })
  .passthrough();

export const BoosterPolicySchema = z
  .object({
    id: z.string().min(1),
    label_fr: z.string().optional()
  })
  .passthrough();

export const DoseCapSchema = z
  .object({
    counter: z.string().min(1),
    max_doses: z.number().int().positive(),
    before_age: DurationSchema
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

    primary_series: PrimarySeriesSchema.optional(),
    booster_policies: z.array(BoosterPolicySchema).optional(),
    dose_caps: z.array(DoseCapSchema).optional(),
    catchup_rules: z.array(CatchupRuleSchema).optional(),
    review_flags: z.array(z.any()).optional()
  })
  .passthrough();

export const EligibilityRuleSchema = z
  .object({
    product_group: z.string().min(1),
    min_age: DurationSchema.optional(),
    max_age: DurationSchema.optional()
  })
  .strict();

export const ProductSelectionSchema = z
  .object({
    product_selection: z
      .object({
        label_fr: z.string().optional(),
        description_fr: z.string().optional(),
        selection: z
          .object({
            mode: z.string().optional(),
            coverage_reward: z.number().optional(),
            unneeded_program_penalty: z.number().optional(),
            max_alignment_delay: DurationSchema.optional()
          })
          .passthrough()
          .optional(),
        eligibility: z.array(EligibilityRuleSchema).optional(),
        product_ranking: z.array(z.string().min(1)).optional(),
        availability_policies: z.array(z.any()).optional(),
        preferences: z.array(z.any()).optional()
      })
      .passthrough()
  })
  .passthrough();

export const SpacingPairSchema = z
  .object({
    product_a: z.string().min(1),
    product_b: z.string().min(1)
  })
  .strict();

export const SpacingRuleSchema = z
  .object({
    id: z.string().min(1),
    label_fr: z.string().optional(),
    description_fr: z.string().optional(),
    applies_when: z
      .object({
        both_live: z.boolean().optional(),
        pairs: z.array(SpacingPairSchema).optional()
      })
      .passthrough(),
    min_gap: DurationSchema,
    same_day_allowed: z.boolean().optional(),
    exemptions: z.array(SpacingPairSchema).optional(),
    move_on_tie: z.string().min(1).optional(),
    move: z.string().min(1).optional()
  })
  .passthrough();

export const SpacingSchema = z
  .object({
    spacing_rules: z.array(SpacingRuleSchema).default([])
  })
  .passthrough();

export type Catalog = z.infer<typeof CatalogSchema>;
export type Counters = z.infer<typeof CountersSchema>;
export type Program = z.infer<typeof ProgramSchema>;
export type ProductSelection = z.infer<typeof ProductSelectionSchema>;
export type Spacing = z.infer<typeof SpacingSchema>;
export type PackDuration = z.infer<typeof DurationSchema>;
export type ProductGroup = z.infer<typeof ProductGroupSchema>;
export type CounterDef = z.infer<typeof CounterDefSchema>;
export type DoseValidityRule = z.infer<typeof DoseValidityRuleSchema>;
export type PrimarySeries = z.infer<typeof PrimarySeriesSchema>;
export type BoosterConfig = z.infer<typeof BoosterConfigSchema>;
export type BoosterPolicy = z.infer<typeof BoosterPolicySchema>;
/** Booster policies carry booster_1..N entries; zod keeps them via passthrough. */
export type LooseBoosterPolicy = BoosterPolicy & Record<string, BoosterConfig | undefined>;
export type DoseCap = z.infer<typeof DoseCapSchema>;
export type CatchupRule = z.infer<typeof CatchupRuleSchema>;
export type EligibilityRule = z.infer<typeof EligibilityRuleSchema>;
export type SpacingRule = z.infer<typeof SpacingRuleSchema>;
export type ConditionalInterval = z.infer<typeof ConditionalIntervalSchema>;
export type Interval = PackDuration | ConditionalInterval;
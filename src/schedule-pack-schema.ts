import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Shared schemas                                                      */
/* ------------------------------------------------------------------ */

export const DurationSchema = z
  .object({
    days: z.number().int().min(0).optional(),
    weeks: z.number().int().min(0).optional(),
    months: z.number().int().min(0).optional(),
    years: z.number().int().min(0).optional()
  })
  .passthrough();

export const NotesSchema = z.union([
  z.string(),
  z.array(z.string())
]);

export const ConfidenceSchema = z.enum([
  "official",
  "draft",
  "needs_validation"
]);

/* ------------------------------------------------------------------ */
/* Catalog schemas                                                     */
/* ------------------------------------------------------------------ */

export const AntigenSchema = z
  .object({
    id: z.string().min(1),
    label_fr: z.string().min(1)
  })
  .passthrough();

export const ProductGroupSchema = z
  .object({
    id: z.string().min(1),
    label_fr: z.string().min(1),
    satisfies_antigens: z.array(z.string().min(1)).min(1),
    age_limits: z.record(z.string(), z.unknown()).optional(),
    confidence: z.string().optional(),
    notes: NotesSchema.optional()
  })
  .passthrough();

export const CatalogSchema = z
  .object({
    meta: z
      .object({
        country: z.string().min(1),
        pack_id: z.string().min(1),
        version: z.string().min(1),
        status: z.string().min(1),
        clinical_approval: z.string().min(1)
      })
      .passthrough(),

    antigens: z.array(AntigenSchema).min(1),

    product_groups: z.array(ProductGroupSchema).min(1)
  })
  .passthrough();

/* ------------------------------------------------------------------ */
/* Counter schemas                                                     */
/* ------------------------------------------------------------------ */

export const CounterSchema = z
  .object({
    id: z.string().min(1),
    label_fr: z.string().min(1),
    description_fr: z.string().optional(),
    counts_product_groups: z.array(z.string().min(1)).min(1),
    only_valid_doses: z.boolean().optional(),
    product_history_aware: z.boolean().optional(),
    confidence: z.string().optional()
  })
  .passthrough();

export const CountersSchema = z
  .object({
    counters: z.array(CounterSchema).min(1)
  })
  .passthrough();

/* ------------------------------------------------------------------ */
/* DTP program schemas                                                 */
/* ------------------------------------------------------------------ */

export const DtpProgramSchema = z
  .object({
    id: z.string().min(1),
    label_fr: z.string().min(1),
    description_fr: z.string().optional(),
    counter: z.string().min(1),
    primary_series: z
      .object({
        required_valid_doses: z.number().int().min(0)
      })
      .passthrough(),
    booster_policy: z.string().min(1)
  })
  .passthrough();

export const BoosterStepSchema = z
  .object({
    product_group: z.string().min(1),
    min_age: DurationSchema.optional(),
    min_interval_after_primary_completion: DurationSchema.optional(),
    min_interval_after_booster_1: DurationSchema.optional()
  })
  .passthrough();

export const BoosterPolicySchema = z
  .object({
    id: z.string().min(1),
    label_fr: z.string().min(1),
    booster_1: BoosterStepSchema,
    booster_2: BoosterStepSchema
  })
  .passthrough();

export const ProtocolStepSchema = z
  .object({
    seq: z.number().int().min(1),
    product_group: z.string().min(1),
    timing: z.string().optional(),
    min_interval: DurationSchema.optional(),
    role: z
      .enum(["primary", "primary_completion", "booster_1", "booster_2"])
      .optional()
  })
  .passthrough();

export const ProtocolSchema = z
  .object({
    id: z.string().min(1),
    label_fr: z.string().min(1),
    type: z.string().min(1),
    confidence: ConfidenceSchema.optional(),
    notes: NotesSchema.optional(),
    steps: z.array(ProtocolStepSchema).min(1)
  })
  .passthrough();

/* ------------------------------------------------------------------ */
/* Catch-up rule schemas                                               */
/* ------------------------------------------------------------------ */

export const AgeBoundarySchema = z
  .object({
    from: DurationSchema.optional(),
    to_before: DurationSchema.optional()
  })
  .passthrough();

export const CounterConditionSchema = z
  .object({
    id: z.string().min(1),
    equals: z.number().int().min(0).optional(),
    gte: z.number().int().min(0).optional()
  })
  .passthrough()
  .refine(
    (condition) =>
      condition.equals !== undefined || condition.gte !== undefined,
    {
      message: "Counter condition must contain equals or gte",
      path: ["equals"]
    }
  );

export const CatchupWhenSchema = z
  .object({
    age: AgeBoundarySchema.optional(),
    counter: CounterConditionSchema
  })
  .passthrough();

export const CatchupThenSchema = z
  .object({
    action: z.enum([
      "start_protocol",
      "schedule_future",
      "give_if_due",
      "complete",
      "needs_review"
    ]),
    protocol: z.string().optional(),
    booster_policy: z.string().optional(),
    future_dose: z
      .enum(["DTP_BOOSTER_1", "DTP_BOOSTER_2"])
      .optional(),
    dose: z.enum(["DTP_BOOSTER_1", "DTP_BOOSTER_2"]).optional(),
    product_group: z.string().optional(),
    earliest_date_formula: z.string().optional(),
    missing_required_date_behavior: z.string().optional()
  })
  .passthrough()
  .refine(
    (then) =>
      then.action !== "start_protocol" || Boolean(then.protocol),
    {
      message: "start_protocol action requires a protocol",
      path: ["protocol"]
    }
  )
  .refine(
    (then) =>
      then.action !== "schedule_future" || Boolean(then.future_dose),
    {
      message: "schedule_future action requires future_dose",
      path: ["future_dose"]
    }
  )
  .refine(
    (then) => then.action !== "give_if_due" || Boolean(then.dose),
    {
      message: "give_if_due action requires dose",
      path: ["dose"]
    }
  );

export const CatchupRuleSchema = z
  .object({
    id: z.string().min(1),
    label_fr: z.string().min(1),
    when: CatchupWhenSchema,
    then: CatchupThenSchema,
    source: z.string().optional(),
    confidence: ConfidenceSchema.optional()
  })
  .passthrough();

export const ReviewFlagSchema = z
  .object({
    id: z.string().min(1),
    topic: z.string().min(1),
    question: z.string().min(1),
    status: z.string().min(1)
  })
  .passthrough();
export const ValidityDoseSchema = z
  .object({
    dose: z.number().int().min(1),
    days: z.number().optional(),
    weeks: z.number().optional(),
    months: z.number().optional(),
    years: z.number().optional()
  })
  .passthrough();

export const ValidityBoosterSchema = z
  .object({
    dose: z.number().int().min(4),
    label: z.string(),
    min_age: DurationSchema,
    min_interval: DurationSchema
  })
  .passthrough();

export const ValiditySchema = z
  .object({
    primary: z
      .object({
        min_ages: z.array(ValidityDoseSchema).min(1),
        min_interval: DurationSchema
      })
      .passthrough(),
    boosters: z.array(ValidityBoosterSchema).min(1)
  })
  .passthrough();

// Also add Validity to the exported types at the very bottom:
export type Validity = z.infer<typeof ValiditySchema>;

export const DtpProgramPolicySchema = z
  .object({
    program: DtpProgramSchema,
    booster_policies: z.array(BoosterPolicySchema).min(1),
    protocols: z.array(ProtocolSchema).min(1),
    catchup_rules: z.array(CatchupRuleSchema).min(1),
    review_flags: z.array(ReviewFlagSchema).optional(),
    validity: ValiditySchema // <-- ADD THIS LINE
  })
  .passthrough();

/* ------------------------------------------------------------------ */
/* Inferred types                                                      */
/* ------------------------------------------------------------------ */

export type Duration = z.infer<typeof DurationSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;
export type Counter = z.infer<typeof CounterSchema>;
export type Counters = z.infer<typeof CountersSchema>;
export type DtpProgram = z.infer<typeof DtpProgramSchema>;
export type BoosterPolicy = z.infer<typeof BoosterPolicySchema>;
export type Protocol = z.infer<typeof ProtocolSchema>;
export type ProtocolStep = z.infer<typeof ProtocolStepSchema>;
export type CatchupRule = z.infer<typeof CatchupRuleSchema>;
export type ReviewFlag = z.infer<typeof ReviewFlagSchema>;
export type DtpProgramPolicy = z.infer<typeof DtpProgramPolicySchema>;
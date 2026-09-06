import { z } from "zod";

export const dtpActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start_protocol"),
    protocol: z.string().min(1)
  }),

  z.object({
    type: z.literal("schedule_future"),
    futureDose: z.enum(["DTP_BOOSTER_1", "DTP_BOOSTER_2"])
  }),

  z.object({
    type: z.literal("give_if_due"),
    dose: z.enum(["DTP_BOOSTER_1", "DTP_BOOSTER_2"])
  }),

  z.object({
    type: z.literal("complete")
  }),

  z.object({
    type: z.literal("needs_review"),
    reason: z.string().min(1)
  })
]);

export const dtpCatchupRuleSchema = z
  .object({
    id: z.string().min(1),
    labelFr: z.string().min(1),

    ageFromMonths: z.number().int().min(0).optional(),
    ageToBeforeMonths: z.number().int().min(0).optional(),

    validDosesEquals: z.number().int().min(0).optional(),
    validDosesGte: z.number().int().min(0).optional(),

    action: dtpActionSchema,

    confidence: z.enum(["official", "draft", "needs_validation"])
  })
  .refine(
    (rule) =>
      rule.validDosesEquals !== undefined ||
      rule.validDosesGte !== undefined,
    {
      message: "A catch-up rule must have validDosesEquals or validDosesGte",
      path: ["validDosesEquals"]
    }
  )
  .refine(
    (rule) => {
      if (
        rule.ageFromMonths !== undefined &&
        rule.ageToBeforeMonths !== undefined
      ) {
        return rule.ageFromMonths < rule.ageToBeforeMonths;
      }

      return true;
    },
    {
      message: "ageFromMonths must be smaller than ageToBeforeMonths",
      path: ["ageFromMonths"]
    }
  );

export const dtpProgramPolicySchema = z.object({
  program: z.object({
    id: z.string().min(1),
    labelFr: z.string().min(1),
    counter: z.string().min(1)
  }),

  catchup_rules: z.array(dtpCatchupRuleSchema).min(1)
});

export type DtpAction = z.infer<typeof dtpActionSchema>;
export type DtpCatchupRule = z.infer<typeof dtpCatchupRuleSchema>;
export type DtpProgramPolicy = z.infer<typeof dtpProgramPolicySchema>;
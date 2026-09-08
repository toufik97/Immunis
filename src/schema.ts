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
    catchup_rules: z.array(z.any()).optional(),
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
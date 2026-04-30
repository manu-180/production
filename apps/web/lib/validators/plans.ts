import { z } from "zod";
import { paginationQuerySchema } from "./common";

const planNameSchema = z.string().trim().min(1).max(200);
const planDescriptionSchema = z.string().trim().max(5000);
const tagSchema = z.string().trim().min(1).max(50);

export const promptInputSchema = z.object({
  filename: z.string().trim().max(200).optional(),
  title: z.string().trim().max(200).optional(),
  content: z.string().min(1),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
  order_index: z.number().int().min(0).optional(),
});
export type PromptInput = z.infer<typeof promptInputSchema>;

export const planCreateSchema = z.object({
  name: planNameSchema,
  description: planDescriptionSchema.optional(),
  tags: z.array(tagSchema).max(20).optional(),
  is_template: z.boolean().optional(),
  default_working_dir: z.string().trim().max(2000).optional(),
  default_settings: z.record(z.string(), z.unknown()).optional(),
  prompts: z.array(promptInputSchema).max(500).optional(),
});
export type PlanCreate = z.infer<typeof planCreateSchema>;

export const planUpdateSchema = z
  .object({
    name: planNameSchema.optional(),
    description: planDescriptionSchema.nullable().optional(),
    tags: z.array(tagSchema).max(20).optional(),
    is_template: z.boolean().optional(),
    default_working_dir: z.string().trim().max(2000).nullable().optional(),
    default_settings: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });
export type PlanUpdate = z.infer<typeof planUpdateSchema>;

export const planListQuerySchema = paginationQuerySchema.extend({
  tag: tagSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  is_template: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
});
export type PlanListQuery = z.infer<typeof planListQuerySchema>;

export const promptCreateSchema = promptInputSchema;
export const promptUpdateSchema = z
  .object({
    title: z.string().trim().max(200).nullable().optional(),
    filename: z.string().trim().max(200).nullable().optional(),
    content: z.string().min(1).optional(),
    frontmatter: z.record(z.string(), z.unknown()).optional(),
    order_index: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });
export type PromptUpdate = z.infer<typeof promptUpdateSchema>;

export const promptReorderSchema = z.object({
  ordered: z.array(z.string().uuid()).min(1).max(500),
});
export type PromptReorder = z.infer<typeof promptReorderSchema>;

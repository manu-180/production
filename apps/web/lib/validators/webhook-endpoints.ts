import { z } from "zod";

export const createWebhookSchema = z.object({
  name: z.string().trim().min(1).max(100),
  plan_id: z.string().uuid(),
  source: z.enum(["github", "generic"]).default("github"),
  github_event: z.string().trim().min(1).optional().nullable(),
});
export type CreateWebhook = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    plan_id: z.string().uuid().optional(),
    source: z.enum(["github", "generic"]).optional(),
    github_event: z.string().trim().min(1).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });
export type UpdateWebhook = z.infer<typeof updateWebhookSchema>;

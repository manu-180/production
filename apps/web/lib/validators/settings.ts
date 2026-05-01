import { z } from "zod";

export const settingsUpdateSchema = z
  .object({
    auto_approve_low_risk: z.boolean().optional(),
    default_model: z.string().trim().min(1).max(100).optional(),
    git_auto_commit: z.boolean().optional(),
    git_auto_push: z.boolean().optional(),
    notification_channels: z.record(z.string(), z.unknown()).optional(),
    theme: z.enum(["light", "dark", "system"]).optional(),
    onboarding_completed: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

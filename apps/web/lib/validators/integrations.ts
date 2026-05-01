import { z } from "zod";

export const PROVIDERS = ["github", "slack", "discord", "telegram"] as const;
export type Provider = (typeof PROVIDERS)[number];

// ── Per-provider config schemas ───────────────────────────────────────────────

export const githubConfigSchema = z.object({
  pat: z.string().min(1),
});

export const slackConfigSchema = z.object({
  webhook_url: z.string().url(),
});

export const discordConfigSchema = z.object({
  webhook_url: z.string().url(),
});

export const telegramConfigSchema = z.object({
  bot_token: z.string().min(1),
  chat_id: z.string().min(1),
});

// ── Upsert body ───────────────────────────────────────────────────────────────

export const integrationUpsertSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("github"),
    name: z.string().max(100).optional(),
    config: githubConfigSchema,
    enabled: z.boolean().optional(),
  }),
  z.object({
    provider: z.literal("slack"),
    name: z.string().max(100).optional(),
    config: slackConfigSchema,
    enabled: z.boolean().optional(),
  }),
  z.object({
    provider: z.literal("discord"),
    name: z.string().max(100).optional(),
    config: discordConfigSchema,
    enabled: z.boolean().optional(),
  }),
  z.object({
    provider: z.literal("telegram"),
    name: z.string().max(100).optional(),
    config: telegramConfigSchema,
    enabled: z.boolean().optional(),
  }),
]);

export type IntegrationUpsert = z.infer<typeof integrationUpsertSchema>;

// ── PATCH body (partial) ──────────────────────────────────────────────────────

export const integrationPatchSchema = z
  .object({
    name: z.string().max(100).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field required" });

export type IntegrationPatch = z.infer<typeof integrationPatchSchema>;

// ── Row shape returned to client ──────────────────────────────────────────────

export interface IntegrationRow {
  id: string;
  user_id: string;
  provider: Provider;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

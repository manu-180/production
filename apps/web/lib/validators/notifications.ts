import { z } from "zod";

export const EVENT_TYPES = [
  "run.completed",
  "run.failed",
  "auth.invalid",
  "circuit.open",
  "rate_limit.long",
  "approval.required",
  "cost.threshold",
] as const;

export const CHANNELS = ["desktop", "email", "slack", "discord", "telegram"] as const;
export const SEVERITY_THRESHOLDS = ["info", "warning", "critical"] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type Channel = (typeof CHANNELS)[number];
export type SeverityThreshold = (typeof SEVERITY_THRESHOLDS)[number];

export const preferenceUpsertSchema = z.object({
  event_type: z.enum(EVENT_TYPES),
  channel: z.enum(CHANNELS),
  enabled: z.boolean(),
  severity_threshold: z.enum(SEVERITY_THRESHOLDS),
});

export type PreferenceUpsert = z.infer<typeof preferenceUpsertSchema>;

export const testNotificationSchema = z.object({
  channel: z.enum(CHANNELS),
});

export type TestNotification = z.infer<typeof testNotificationSchema>;

const slackConfigSchema = z.object({ webhookUrl: z.string().url().or(z.literal("")) });
const discordConfigSchema = z.object({ webhookUrl: z.string().url().or(z.literal("")) });
const emailConfigSchema = z.object({ to: z.string().email().or(z.literal("")) });
const telegramConfigSchema = z.object({
  botToken: z.string(),
  chatId: z.string(),
});
const desktopConfigSchema = z.object({});

export const channelConfigSchema = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("slack"), config: slackConfigSchema }),
  z.object({ channel: z.literal("discord"), config: discordConfigSchema }),
  z.object({ channel: z.literal("email"), config: emailConfigSchema }),
  z.object({ channel: z.literal("telegram"), config: telegramConfigSchema }),
  z.object({ channel: z.literal("desktop"), config: desktopConfigSchema }),
]);

export type ChannelConfigUpdate = z.infer<typeof channelConfigSchema>;

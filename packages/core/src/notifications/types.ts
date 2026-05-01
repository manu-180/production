export type { NotificationPreference } from "@conductor/db";

export type NotificationEvent =
  | {
      type: "run.completed";
      runId: string;
      planName: string;
      success: boolean;
      durationMs: number;
      costUsd: number;
    }
  | { type: "run.failed"; runId: string; planName: string; reason: string }
  | { type: "auth.invalid" }
  | { type: "circuit.open"; runId: string; planName: string }
  | { type: "rate_limit.long"; waitSeconds: number }
  | { type: "approval.required"; runId: string; promptId: string; planName: string }
  | { type: "cost.threshold"; monthlyUsd: number; thresholdUsd: number };

export type Severity = "info" | "warning" | "critical";

export type Channel = "desktop" | "email" | "slack" | "discord" | "telegram";

export interface NotificationChannelConfig {
  desktop?: Record<string, never>;
  email?: { to: string };
  slack?: { webhookUrl: string };
  discord?: { webhookUrl: string };
  telegram?: { botToken: string; chatId: string };
}

export interface DispatchContext {
  userId: string;
  config: NotificationChannelConfig;
}

import { type Logger, createLogger } from "../logger.js";
import type { BaseChannel, NotificationPayload } from "./channels/base-channel.js";
import { DesktopChannel } from "./channels/desktop-channel.js";
import { DiscordChannel } from "./channels/discord-channel.js";
import { EmailChannel } from "./channels/email-channel.js";
import { SlackChannel } from "./channels/slack-channel.js";
import { TelegramChannel } from "./channels/telegram-channel.js";
import type { NotificationsDbClient } from "./preferences.js";
import { formatBody, formatTitle } from "./templates/index.js";
import type {
  Channel,
  DispatchContext,
  NotificationChannelConfig,
  NotificationEvent,
  NotificationPreference,
  Severity,
} from "./types.js";

const SEVERITY_ORDER: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

export function mapSeverity(event: NotificationEvent): Severity {
  switch (event.type) {
    case "run.completed":
      return event.success ? "info" : "warning";
    case "run.failed":
      return "critical";
    case "auth.invalid":
      return "critical";
    case "circuit.open":
      return "warning";
    case "rate_limit.long":
      return "warning";
    case "approval.required":
      return "info";
    case "cost.threshold":
      return "warning";
  }
}

const CHANNELS: Record<Channel, BaseChannel> = {
  desktop: new DesktopChannel(),
  email: new EmailChannel(),
  slack: new SlackChannel(),
  discord: new DiscordChannel(),
  telegram: new TelegramChannel(),
};

// Module-level map: throttle rate_limit.long to max 1 per hour per user.
// Key: `${userId}:${eventType}`
const rateLimitLastSent = new Map<string, number>();

const RATE_LIMIT_THROTTLE_MS = 60 * 60 * 1_000;

export class NotificationRouter {
  private readonly logger: Logger;

  constructor(
    private readonly db: NotificationsDbClient,
    logger?: Logger,
  ) {
    this.logger = logger ?? createLogger("notifications:router");
  }

  async dispatch(event: NotificationEvent, ctx: DispatchContext): Promise<void> {
    if (event.type === "rate_limit.long") {
      const key = `${ctx.userId}:rate_limit.long`;
      const last = rateLimitLastSent.get(key);
      if (last !== undefined && Date.now() - last < RATE_LIMIT_THROTTLE_MS) {
        this.logger.warn({ userId: ctx.userId }, "rate_limit.long throttled — skipping");
        return;
      }
      rateLimitLastSent.set(key, Date.now());
    }

    const severity = mapSeverity(event);
    const preferences = await this.fetchPreferences(ctx.userId, event.type);

    const payload: NotificationPayload = {
      title: formatTitle(event),
      body: formatBody(event),
      severity,
      event,
    };

    const sends = preferences
      .filter(
        (pref) => pref.enabled && severityAllows(pref.severity_threshold as Severity, severity),
      )
      .map((pref) => this.sendViaChannel(pref.channel as Channel, payload, ctx.config));

    const results = await Promise.allSettled(sends);

    for (const result of results) {
      if (result.status === "rejected") {
        const reason =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        this.logger.warn(
          { err: reason, userId: ctx.userId, eventType: event.type },
          "channel send rejected",
        );
      }
    }
  }

  private async fetchPreferences(
    userId: string,
    eventType: NotificationEvent["type"],
  ): Promise<NotificationPreference[]> {
    try {
      const result = await this.db
        .from("notification_preferences")
        .select("*")
        .eq("user_id", userId)
        .eq("event_type", eventType)
        .eq("enabled", true);

      if (result.error !== null) {
        this.logger.warn(
          { err: result.error.message, userId, eventType },
          "preference lookup failed",
        );
        return [];
      }
      return (result.data ?? []) as NotificationPreference[];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: message, userId, eventType }, "preference lookup threw");
      return [];
    }
  }

  private async sendViaChannel(
    channel: Channel,
    payload: NotificationPayload,
    config: NotificationChannelConfig,
  ): Promise<void> {
    const handler = CHANNELS[channel];
    if (!handler) {
      this.logger.warn({ channel }, "unknown channel — skipping");
      return;
    }
    await handler.send(payload, config);
  }
}

function severityAllows(threshold: Severity, actual: Severity): boolean {
  return SEVERITY_ORDER[actual] >= SEVERITY_ORDER[threshold];
}

import { createLogger } from "../../logger.js";
import type { Channel, NotificationChannelConfig, Severity } from "../types.js";
import { BaseChannel, type NotificationPayload } from "./base-channel.js";

const logger = createLogger("notifications:discord-channel");

const EMBED_COLORS: Record<Severity, number> = {
  info: 5763719,
  warning: 16776960,
  critical: 15548997,
};

export class DiscordChannel extends BaseChannel {
  readonly channelType: Channel = "discord";

  async send(payload: NotificationPayload, config: NotificationChannelConfig): Promise<void> {
    const webhookUrl = config.discord?.webhookUrl;
    if (!webhookUrl) {
      logger.warn("discord channel config missing `webhookUrl` — skipping");
      return;
    }

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [
            {
              title: payload.title,
              description: payload.body,
              color: EMBED_COLORS[payload.severity],
            },
          ],
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "(unreadable body)");
        logger.warn({ status: res.status, body: text }, "discord webhook returned non-2xx");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "discord send threw");
    }
  }
}

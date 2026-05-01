import { createLogger } from "../../logger.js";
import type { Channel, NotificationChannelConfig } from "../types.js";
import { BaseChannel, type NotificationPayload } from "./base-channel.js";

const logger = createLogger("notifications:slack-channel");

export class SlackChannel extends BaseChannel {
  readonly channelType: Channel = "slack";

  async send(payload: NotificationPayload, config: NotificationChannelConfig): Promise<void> {
    const webhookUrl = config.slack?.webhookUrl;
    if (!webhookUrl) {
      logger.warn("slack channel config missing `webhookUrl` — skipping");
      return;
    }

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blocks: [
            {
              type: "header",
              text: { type: "plain_text", text: payload.title },
            },
            {
              type: "section",
              text: { type: "mrkdwn", text: payload.body },
            },
            {
              type: "context",
              elements: [{ type: "mrkdwn", text: `Severity: ${payload.severity}` }],
            },
          ],
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "(unreadable body)");
        logger.warn({ status: res.status, body: text }, "slack webhook returned non-2xx");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "slack send threw");
    }
  }
}

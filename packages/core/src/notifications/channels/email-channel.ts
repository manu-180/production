import { createLogger } from "../../logger.js";
import type { Channel, NotificationChannelConfig } from "../types.js";
import { BaseChannel, type NotificationPayload } from "./base-channel.js";

const logger = createLogger("notifications:email-channel");

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export class EmailChannel extends BaseChannel {
  readonly channelType: Channel = "email";

  async send(payload: NotificationPayload, config: NotificationChannelConfig): Promise<void> {
    const apiKey = process.env["RESEND_API_KEY"];
    if (!apiKey) {
      logger.warn("RESEND_API_KEY not set — skipping email notification");
      return;
    }

    const to = config.email?.to;
    if (!to) {
      logger.warn("email channel config missing `to` — skipping");
      return;
    }

    const from = process.env["NOTIFICATIONS_FROM_EMAIL"] ?? "conductor@notifications.app";

    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to,
          subject: payload.title,
          text: payload.body,
          html: `<p>${payload.body.replace(/\n/g, "<br>")}</p>`,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "(unreadable body)");
        logger.warn({ status: res.status, body: text }, "resend API returned non-2xx");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "email send threw");
    }
  }
}

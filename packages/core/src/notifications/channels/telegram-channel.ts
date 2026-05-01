import { createLogger } from "../../logger.js";
import type { Channel, NotificationChannelConfig } from "../types.js";
import { BaseChannel, type NotificationPayload } from "./base-channel.js";

const logger = createLogger("notifications:telegram-channel");

export class TelegramChannel extends BaseChannel {
  readonly channelType: Channel = "telegram";

  async send(payload: NotificationPayload, config: NotificationChannelConfig): Promise<void> {
    const telegramConfig = config.telegram;
    if (!telegramConfig) {
      logger.warn("telegram channel config missing — skipping");
      return;
    }

    const { botToken, chatId } = telegramConfig;
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `${payload.title}\n\n${payload.body}`,
          parse_mode: "HTML",
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "(unreadable body)");
        logger.warn({ status: res.status, body: text }, "telegram API returned non-2xx");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "telegram send threw");
    }
  }
}

import { EventEmitter } from "node:events";
import type { Channel, NotificationChannelConfig } from "../types.js";
import { BaseChannel, type NotificationPayload } from "./base-channel.js";

export const desktopEmitter = new EventEmitter();

export const DESKTOP_NOTIFICATION_EVENT = "conductor:notification";

export class DesktopChannel extends BaseChannel {
  readonly channelType: Channel = "desktop";

  async send(payload: NotificationPayload, _config: NotificationChannelConfig): Promise<void> {
    try {
      desktopEmitter.emit(DESKTOP_NOTIFICATION_EVENT, payload);
    } catch {
      // Fire-and-forget: emitter errors must not propagate to the router
    }
  }
}

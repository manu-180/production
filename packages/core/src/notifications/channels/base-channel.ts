import type { Channel, NotificationChannelConfig, NotificationEvent, Severity } from "../types.js";

export interface NotificationPayload {
  title: string;
  body: string;
  severity: Severity;
  event: NotificationEvent;
  actionUrl?: string;
}

export abstract class BaseChannel {
  abstract readonly channelType: Channel;
  abstract send(payload: NotificationPayload, config: NotificationChannelConfig): Promise<void>;
}

export { NotificationRouter, mapSeverity } from "./notification-router.js";

export type {
  NotificationEvent,
  NotificationPreference,
  Severity,
  Channel,
  NotificationChannelConfig,
  DispatchContext,
} from "./types.js";

export { BaseChannel, type NotificationPayload } from "./channels/base-channel.js";
export {
  DesktopChannel,
  desktopEmitter,
  DESKTOP_NOTIFICATION_EVENT,
} from "./channels/desktop-channel.js";
export { EmailChannel } from "./channels/email-channel.js";
export { SlackChannel } from "./channels/slack-channel.js";
export { DiscordChannel } from "./channels/discord-channel.js";
export { TelegramChannel } from "./channels/telegram-channel.js";

export {
  getPreferences,
  upsertPreference,
  seedDefaultPreferences,
  type NotificationsDbClient,
} from "./preferences.js";

export { formatTitle, formatBody } from "./templates/index.js";

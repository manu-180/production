import { createLogger } from "../logger.js";
import type { Channel, NotificationEvent, NotificationPreference, Severity } from "./types.js";

const logger = createLogger("notifications:preferences");

const TABLE = "notification_preferences";

// Extends the base DbClient with upsert, which the notifications module needs
// for idempotent preference writes. Kept minimal to allow test stubs.
export interface DbTableWithUpsert {
  insert(row: Record<string, unknown>): DbTableWithUpsert;
  upsert(row: Record<string, unknown> | Record<string, unknown>[]): DbTableWithUpsert;
  update(data: Record<string, unknown>): DbTableWithUpsert;
  select(columns?: string): DbTableWithUpsert;
  eq(column: string, value: unknown): DbTableWithUpsert;
  in(column: string, values: unknown[]): DbTableWithUpsert;
  order(column: string, options?: { ascending?: boolean }): DbTableWithUpsert;
  single(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
  then<
    TResult1 = { data: Record<string, unknown>[] | null; error: { message: string } | null },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((value: { data: Record<string, unknown>[] | null; error: { message: string } | null }) =>
          | TResult1
          | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}

export interface NotificationsDbClient {
  from(table: string): DbTableWithUpsert;
}

export async function getPreferences(
  db: NotificationsDbClient,
  userId: string,
): Promise<NotificationPreference[]> {
  try {
    const result = await db.from(TABLE).select("*").eq("user_id", userId);
    if (result.error !== null) {
      logger.warn({ err: result.error.message, userId }, "getPreferences query failed");
      return [];
    }
    return (result.data ?? []) as NotificationPreference[];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message, userId }, "getPreferences threw");
    return [];
  }
}

export async function upsertPreference(
  db: NotificationsDbClient,
  userId: string,
  eventType: NotificationEvent["type"],
  channel: Channel,
  enabled: boolean,
  severityThreshold: Severity,
): Promise<void> {
  try {
    const result = await db
      .from(TABLE)
      .upsert({
        user_id: userId,
        event_type: eventType,
        channel,
        enabled,
        severity_threshold: severityThreshold,
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (result.error !== null) {
      logger.warn(
        { err: result.error.message, userId, eventType, channel },
        "upsertPreference failed",
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message, userId, eventType, channel }, "upsertPreference threw");
  }
}

type DefaultPreference = {
  event_type: NotificationEvent["type"];
  channel: Channel;
  enabled: boolean;
  severity_threshold: Severity;
};

const DEFAULT_PREFERENCES: DefaultPreference[] = [
  { event_type: "run.failed", channel: "desktop", enabled: true, severity_threshold: "info" },
  { event_type: "run.failed", channel: "email", enabled: true, severity_threshold: "info" },
  { event_type: "run.failed", channel: "slack", enabled: true, severity_threshold: "info" },
  { event_type: "run.failed", channel: "discord", enabled: true, severity_threshold: "info" },
  { event_type: "run.failed", channel: "telegram", enabled: true, severity_threshold: "info" },
  { event_type: "run.completed", channel: "desktop", enabled: true, severity_threshold: "info" },
  { event_type: "auth.invalid", channel: "desktop", enabled: true, severity_threshold: "info" },
  { event_type: "auth.invalid", channel: "email", enabled: true, severity_threshold: "info" },
  { event_type: "cost.threshold", channel: "email", enabled: true, severity_threshold: "info" },
];

export async function seedDefaultPreferences(
  db: NotificationsDbClient,
  userId: string,
): Promise<void> {
  const rows = DEFAULT_PREFERENCES.map((pref) => ({
    ...pref,
    user_id: userId,
    updated_at: new Date().toISOString(),
  }));

  try {
    const result = await db.from(TABLE).upsert(rows).select("id").single();
    if (result.error !== null) {
      logger.warn({ err: result.error.message, userId }, "seedDefaultPreferences failed");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message, userId }, "seedDefaultPreferences threw");
  }
}

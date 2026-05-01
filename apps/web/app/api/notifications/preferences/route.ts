import { defineRoute, respond, respondError } from "@/lib/api";
import { type PreferenceUpsert, preferenceUpsertSchema } from "@/lib/validators/notifications";
import type { NotificationPreference } from "@conductor/db";

export const dynamic = "force-dynamic";

// Default preferences seeded when a user has none yet.
const DEFAULT_PREFERENCES: Omit<NotificationPreference, "id" | "updated_at">[] = [
  {
    user_id: "",
    event_type: "run.failed",
    channel: "desktop",
    enabled: true,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "run.failed",
    channel: "email",
    enabled: true,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "run.failed",
    channel: "slack",
    enabled: true,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "run.failed",
    channel: "discord",
    enabled: true,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "run.failed",
    channel: "telegram",
    enabled: true,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "run.completed",
    channel: "desktop",
    enabled: true,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "auth.invalid",
    channel: "desktop",
    enabled: true,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "auth.invalid",
    channel: "email",
    enabled: true,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "cost.threshold",
    channel: "email",
    enabled: true,
    severity_threshold: "info",
  },
  // remaining event/channel combos default to disabled
  {
    user_id: "",
    event_type: "run.completed",
    channel: "email",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "run.completed",
    channel: "slack",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "run.completed",
    channel: "discord",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "run.completed",
    channel: "telegram",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "circuit.open",
    channel: "desktop",
    enabled: true,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "circuit.open",
    channel: "email",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "circuit.open",
    channel: "slack",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "circuit.open",
    channel: "discord",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "circuit.open",
    channel: "telegram",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "rate_limit.long",
    channel: "desktop",
    enabled: true,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "rate_limit.long",
    channel: "email",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "rate_limit.long",
    channel: "slack",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "rate_limit.long",
    channel: "discord",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "rate_limit.long",
    channel: "telegram",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "approval.required",
    channel: "desktop",
    enabled: true,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "approval.required",
    channel: "email",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "approval.required",
    channel: "slack",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "approval.required",
    channel: "discord",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "approval.required",
    channel: "telegram",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "cost.threshold",
    channel: "desktop",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "cost.threshold",
    channel: "slack",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "cost.threshold",
    channel: "discord",
    enabled: false,
    severity_threshold: "info",
  },
  {
    user_id: "",
    event_type: "cost.threshold",
    channel: "telegram",
    enabled: false,
    severity_threshold: "info",
  },
];

/**
 * GET /api/notifications/preferences
 * Returns all notification_preferences for the authenticated user.
 * If none exist, seeds defaults first (upsert idempotent).
 */
export const GET = defineRoute<undefined, undefined>({}, async ({ user, traceId }) => {
  const { data: existing, error: fetchError } = await user.db
    .from("notification_preferences")
    .select("*")
    .eq("user_id", user.userId);

  if (fetchError !== null) {
    return respondError("internal", "Failed to load notification preferences", {
      traceId,
      details: { code: fetchError.code },
    });
  }

  if (existing !== null && existing.length > 0) {
    return respond(existing, { traceId });
  }

  // No preferences yet — seed defaults
  const rows = DEFAULT_PREFERENCES.map((pref) => ({
    ...pref,
    user_id: user.userId,
    updated_at: new Date().toISOString(),
  }));

  // biome-ignore lint/suspicious/noExplicitAny: upsert payload with Json columns
  const { data: seeded, error: seedError } = await (user.db as any)
    .from("notification_preferences")
    .upsert(rows, { onConflict: "user_id,event_type,channel" })
    .select();

  if (seedError !== null) {
    return respondError("internal", "Failed to seed notification preferences", {
      traceId,
      details: { code: seedError.code },
    });
  }

  return respond(seeded ?? rows, { traceId });
});

/**
 * PUT /api/notifications/preferences
 * Upserts a single preference for the authenticated user.
 * Body: { event_type, channel, enabled, severity_threshold }
 */
export const PUT = defineRoute<PreferenceUpsert>(
  { rateLimit: "mutation", bodySchema: preferenceUpsertSchema },
  async ({ user, traceId, body }) => {
    const row = {
      user_id: user.userId,
      event_type: body.event_type,
      channel: body.channel,
      enabled: body.enabled,
      severity_threshold: body.severity_threshold,
      updated_at: new Date().toISOString(),
    };

    // biome-ignore lint/suspicious/noExplicitAny: upsert payload
    const { data, error } = await (user.db as any)
      .from("notification_preferences")
      .upsert(row, { onConflict: "user_id,event_type,channel" })
      .select()
      .maybeSingle();

    if (error !== null || data === null) {
      return respondError("internal", "Failed to update preference", {
        traceId,
        details: error ? { code: error.code } : undefined,
      });
    }

    return respond(data, { traceId });
  },
);

import { defineRoute, respond, respondError } from "@/lib/api";
import { type SettingsUpdate, settingsUpdateSchema } from "@/lib/validators/settings";
import { AuditLogger, type DbClient } from "@conductor/core";
import { createServiceClient } from "@conductor/db";

export const dynamic = "force-dynamic";

interface SettingsRow {
  user_id: string;
  theme: string;
  color_theme: string;
  auto_approve_low_risk: boolean;
  default_model: string;
  git_auto_commit: boolean;
  git_auto_push: boolean;
  notification_channels: unknown;
  onboarding_completed?: boolean;
  updated_at?: string;
}

const DEFAULTS: Omit<SettingsRow, "user_id" | "updated_at"> = {
  theme: "system",
  color_theme: "conductor-classic",
  auto_approve_low_risk: false,
  default_model: "sonnet",
  git_auto_commit: true,
  git_auto_push: false,
  notification_channels: {},
  onboarding_completed: false,
};

/**
 * GET /api/settings — return the current user's settings.
 *
 * If no row exists yet we return the defaults inline rather than upserting —
 * a read shouldn't have a side-effect. The first PATCH the user issues
 * materializes the row.
 */
export const GET = defineRoute<undefined, undefined>({}, async ({ user, traceId }) => {
  const { data, error } = await user.db
    .from("settings")
    .select("*")
    .eq("user_id", user.userId)
    .maybeSingle();

  if (error !== null) {
    return respondError("internal", "Failed to load settings", {
      traceId,
      details: { code: error.code },
    });
  }

  if (data === null) {
    return respond({ ...DEFAULTS, user_id: user.userId, updated_at: null }, { traceId });
  }

  return respond(data, { traceId });
});

/**
 * PATCH /api/settings — upsert partial settings for the current user.
 *
 * Schema rejects empty bodies (`refine(keys.length > 0)`), so by the time we
 * upsert we have at least one column to set. We pull the existing row first
 * to merge — Supabase's upsert with `onConflict` would otherwise overwrite
 * unspecified columns with their column defaults.
 */
export const PATCH = defineRoute<SettingsUpdate>(
  { rateLimit: "mutation", bodySchema: settingsUpdateSchema },
  async ({ user, traceId, body }) => {
    const { data: existing } = await user.db
      .from("settings")
      .select("*")
      .eq("user_id", user.userId)
      .maybeSingle();

    const merged = {
      ...DEFAULTS,
      ...(existing ?? {}),
      ...body,
      user_id: user.userId,
    };

    // notification_channels is a `Json`-typed column. The zod schema accepts
    // `Record<string, unknown>`, which is structurally compatible at runtime
    // but not statically — cast through `never` (same pattern as plans).
    const { data, error } = await user.db
      .from("settings")
      // biome-ignore lint/suspicious/noExplicitAny: Json column upsert payload
      .upsert(merged as any, { onConflict: "user_id" })
      .select()
      .maybeSingle();

    if (error !== null || data === null) {
      return respondError("internal", "Failed to update settings", {
        traceId,
        details: error ? { code: error.code } : undefined,
      });
    }

    const svc = createServiceClient();
    const audit = new AuditLogger(svc as unknown as DbClient);
    void audit.log({
      actor: "user",
      action: "settings.updated",
      userId: user.userId,
      resourceType: "settings",
      resourceId: user.userId,
      metadata: { changed: Object.keys(body) },
    });
    return respond(data, { traceId });
  },
);

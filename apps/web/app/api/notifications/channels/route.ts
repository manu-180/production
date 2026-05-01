import { defineRoute, respond, respondError } from "@/lib/api";
import { type ChannelConfigUpdate, channelConfigSchema } from "@/lib/validators/notifications";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications/channels
 * Returns current channel configs from the integrations table.
 * Channels without a row are omitted — the client treats them as unconfigured.
 */
export const GET = defineRoute<undefined, undefined>({}, async ({ user, traceId }) => {
  const { data, error } = await user.db
    .from("integrations")
    .select("channel, config, updated_at")
    .eq("user_id", user.userId);

  if (error !== null) {
    return respondError("internal", "Failed to load channel configurations", {
      traceId,
      details: { code: error.code },
    });
  }

  // Return as a map keyed by channel for easy client-side lookup
  const configs: Record<string, unknown> = {};
  for (const row of data ?? []) {
    configs[row.channel] = row.config;
  }

  return respond(configs, { traceId });
});

/**
 * PUT /api/notifications/channels
 * Upserts a channel configuration.
 * Body: { channel, config }
 */
export const PUT = defineRoute<ChannelConfigUpdate>(
  { rateLimit: "mutation", bodySchema: channelConfigSchema },
  async ({ user, traceId, body }) => {
    const row = {
      user_id: user.userId,
      channel: body.channel,
      config: body.config,
      updated_at: new Date().toISOString(),
    };

    // biome-ignore lint/suspicious/noExplicitAny: upsert payload with Json column
    const { data, error } = await (user.db as any)
      .from("integrations")
      .upsert(row, { onConflict: "user_id,channel" })
      .select()
      .maybeSingle();

    if (error !== null || data === null) {
      return respondError("internal", "Failed to save channel configuration", {
        traceId,
        details: error ? { code: error.code } : undefined,
      });
    }

    return respond({ channel: data.channel, config: data.config }, { traceId });
  },
);

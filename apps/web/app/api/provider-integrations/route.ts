import { defineRoute, respond, respondError } from "@/lib/api";
import {
  type IntegrationRow,
  type IntegrationUpsert,
  integrationUpsertSchema,
} from "@/lib/validators/integrations";

export const dynamic = "force-dynamic";

/**
 * GET /api/provider-integrations
 * Returns all provider integrations for the authenticated user.
 *
 * Note: `provider_integrations` is not yet in the generated Supabase types
 * because the migration runs at deploy time. The `db as any` cast is
 * intentional and will be removed once `pnpm supabase gen types` is re-run.
 */
export const GET = defineRoute<undefined, undefined>({}, async ({ user, traceId }) => {
  // biome-ignore lint/suspicious/noExplicitAny: table not yet in generated types
  const { data, error } = await (user.db as any)
    .from("provider_integrations")
    .select("*")
    .eq("user_id", user.userId)
    .order("created_at", { ascending: true });

  if (error !== null) {
    return respondError("internal", "Failed to load integrations", {
      traceId,
      details: { code: (error as { code: string }).code },
    });
  }

  return respond((data ?? []) as IntegrationRow[], { traceId });
});

/**
 * POST /api/provider-integrations
 * Upserts an integration by (user_id, provider).
 * Body: { provider, name?, config, enabled? }
 */
export const POST = defineRoute<IntegrationUpsert>(
  { rateLimit: "mutation", bodySchema: integrationUpsertSchema },
  async ({ user, traceId, body }) => {
    const row = {
      user_id: user.userId,
      provider: body.provider,
      name: body.name ?? body.provider,
      config: body.config,
      enabled: body.enabled ?? true,
      updated_at: new Date().toISOString(),
    };

    // biome-ignore lint/suspicious/noExplicitAny: table not yet in generated types
    const { data, error } = await (user.db as any)
      .from("provider_integrations")
      .upsert(row, { onConflict: "user_id,provider" })
      .select()
      .maybeSingle();

    if (error !== null || data === null) {
      return respondError("internal", "Failed to save integration", {
        traceId,
        details: error ? { code: (error as { code: string }).code } : undefined,
      });
    }

    return respond(data as IntegrationRow, { traceId, status: 201 });
  },
);

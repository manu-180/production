import { defineRoute, respond, respondError, respondNoContent } from "@/lib/api";
import {
  type IntegrationPatch,
  type IntegrationRow,
  integrationPatchSchema,
} from "@/lib/validators/integrations";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

/**
 * PATCH /api/provider-integrations/:id
 * Partial update — enable/disable, update config or name.
 *
 * Note: `provider_integrations` is not yet in the generated Supabase types.
 * The `db as any` casts will be removed once `pnpm supabase gen types` re-runs.
 */
export const PATCH = defineRoute<IntegrationPatch, undefined, Params>(
  { rateLimit: "mutation", bodySchema: integrationPatchSchema },
  async ({ user, traceId, body, params }) => {
    // Verify ownership
    // biome-ignore lint/suspicious/noExplicitAny: table not yet in generated types
    const { data: existing } = await (user.db as any)
      .from("provider_integrations")
      .select("id")
      .eq("id", params.id)
      .eq("user_id", user.userId)
      .maybeSingle();

    if (existing === null || existing === undefined) {
      return respondError("not_found", "Integration not found", { traceId });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch["name"] = body.name;
    if (body.enabled !== undefined) patch["enabled"] = body.enabled;
    if (body.config !== undefined) patch["config"] = body.config;

    // biome-ignore lint/suspicious/noExplicitAny: table not yet in generated types
    const { data, error } = await (user.db as any)
      .from("provider_integrations")
      .update(patch)
      .eq("id", params.id)
      .eq("user_id", user.userId)
      .select()
      .maybeSingle();

    if (error !== null || data === null) {
      return respondError("internal", "Failed to update integration", {
        traceId,
        details: error ? { code: (error as { code: string }).code } : undefined,
      });
    }

    return respond(data as IntegrationRow, { traceId });
  },
);

/**
 * DELETE /api/provider-integrations/:id
 * Removes the integration row.
 */
export const DELETE = defineRoute<undefined, undefined, Params>(
  { rateLimit: "mutation" },
  async ({ user, traceId, params }) => {
    // biome-ignore lint/suspicious/noExplicitAny: table not yet in generated types
    const { data: existing } = await (user.db as any)
      .from("provider_integrations")
      .select("id")
      .eq("id", params.id)
      .eq("user_id", user.userId)
      .maybeSingle();

    if (existing === null || existing === undefined) {
      return respondError("not_found", "Integration not found", { traceId });
    }

    // biome-ignore lint/suspicious/noExplicitAny: table not yet in generated types
    const { error } = await (user.db as any)
      .from("provider_integrations")
      .delete()
      .eq("id", params.id)
      .eq("user_id", user.userId);

    if (error !== null) {
      return respondError("internal", "Failed to delete integration", {
        traceId,
        details: { code: (error as { code: string }).code },
      });
    }

    return respondNoContent(traceId);
  },
);

import { defineRoute, respond, respondError, respondNoContent } from "@/lib/api";
import { type UpdateWebhook, updateWebhookSchema } from "@/lib/validators/webhook-endpoints";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

/**
 * GET /api/webhook-endpoints/:id — fetch a single webhook endpoint.
 */
export const GET = defineRoute<undefined, undefined, Params>(
  {},
  async ({ user, traceId, params }) => {
    const { data: endpoint, error } = await user.db
      .from("webhook_endpoints")
      .select("*, plans(id, name)")
      .eq("id", params.id)
      .eq("user_id", user.userId)
      .maybeSingle();

    if (error !== null) {
      return respondError("internal", "Failed to load webhook endpoint", {
        traceId,
        details: { code: error.code },
      });
    }
    if (endpoint === null) {
      return respondError("not_found", "Webhook endpoint not found", { traceId });
    }

    return respond(endpoint, { traceId });
  },
);

/**
 * PATCH /api/webhook-endpoints/:id — partial update with ownership check.
 */
export const PATCH = defineRoute<UpdateWebhook, undefined, Params>(
  { rateLimit: "mutation", bodySchema: updateWebhookSchema },
  async ({ user, traceId, body, params }) => {
    // If plan_id is being changed, verify the new plan belongs to the user.
    if (body.plan_id !== undefined) {
      const { data: plan, error: planErr } = await user.db
        .from("plans")
        .select("id")
        .eq("id", body.plan_id)
        .eq("user_id", user.userId)
        .maybeSingle();

      if (planErr !== null) {
        return respondError("internal", "Failed to verify plan ownership", {
          traceId,
          details: { code: planErr.code },
        });
      }
      if (plan === null) {
        return respondError("not_found", "Plan not found", { traceId });
      }
    }

    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update["name"] = body.name;
    if (body.plan_id !== undefined) update["plan_id"] = body.plan_id;
    if (body.source !== undefined) update["source"] = body.source;
    if (body.github_event !== undefined) update["github_event"] = body.github_event;
    if (body.enabled !== undefined) update["enabled"] = body.enabled;

    const { data: endpoint, error } = await user.db
      .from("webhook_endpoints")
      // biome-ignore lint/suspicious/noExplicitAny: structural update payload
      .update(update as any)
      .eq("id", params.id)
      .eq("user_id", user.userId)
      .select("*, plans(id, name)")
      .maybeSingle();

    if (error !== null) {
      return respondError("internal", "Failed to update webhook endpoint", {
        traceId,
        details: { code: error.code },
      });
    }
    if (endpoint === null) {
      return respondError("not_found", "Webhook endpoint not found", { traceId });
    }

    return respond(endpoint, { traceId });
  },
);

/**
 * DELETE /api/webhook-endpoints/:id — hard delete with ownership check.
 */
export const DELETE = defineRoute<undefined, undefined, Params>(
  { rateLimit: "mutation" },
  async ({ user, traceId, params }) => {
    const { data: existing, error: lookupErr } = await user.db
      .from("webhook_endpoints")
      .select("id")
      .eq("id", params.id)
      .eq("user_id", user.userId)
      .maybeSingle();

    if (lookupErr !== null) {
      return respondError("internal", "Failed to look up webhook endpoint", {
        traceId,
        details: { code: lookupErr.code },
      });
    }
    if (existing === null) {
      return respondError("not_found", "Webhook endpoint not found", { traceId });
    }

    const { error: delErr } = await user.db.from("webhook_endpoints").delete().eq("id", params.id);

    if (delErr !== null) {
      return respondError("internal", "Failed to delete webhook endpoint", {
        traceId,
        details: { code: delErr.code },
      });
    }

    return respondNoContent(traceId);
  },
);

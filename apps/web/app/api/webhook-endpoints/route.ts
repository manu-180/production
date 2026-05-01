import { randomBytes } from "node:crypto";
import { defineRoute, respond, respondError } from "@/lib/api";
import { type CreateWebhook, createWebhookSchema } from "@/lib/validators/webhook-endpoints";

export const dynamic = "force-dynamic";

/**
 * GET /api/webhook-endpoints — list all webhook endpoints for the
 * authenticated user.
 */
export const GET = defineRoute({}, async ({ user, traceId }) => {
  const { data, error } = await user.db
    .from("webhook_endpoints")
    .select("*, plans(id, name)")
    .eq("user_id", user.userId)
    .order("created_at", { ascending: false });

  if (error !== null) {
    return respondError("internal", "Failed to load webhook endpoints", {
      traceId,
      details: { code: error.code },
    });
  }

  return respond({ webhookEndpoints: data ?? [] }, { traceId });
});

/**
 * POST /api/webhook-endpoints — create a new webhook endpoint.
 * Auto-generates a cryptographically random HMAC secret.
 */
export const POST = defineRoute<CreateWebhook>(
  { rateLimit: "mutation", bodySchema: createWebhookSchema },
  async ({ user, traceId, body }) => {
    // Verify the referenced plan belongs to the user before creating.
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

    const secret = randomBytes(32).toString("hex");

    const { data: endpoint, error } = await user.db
      .from("webhook_endpoints")
      .insert({
        user_id: user.userId,
        plan_id: body.plan_id,
        name: body.name,
        secret,
        source: body.source,
        github_event: body.github_event ?? null,
        enabled: true,
      })
      .select("*, plans(id, name)")
      .single();

    if (error !== null || endpoint === null) {
      return respondError("internal", "Failed to create webhook endpoint", {
        traceId,
        details: error ? { code: error.code } : undefined,
      });
    }

    return respond(endpoint, { status: 201, traceId });
  },
);

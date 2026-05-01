import { generateTraceId } from "@/lib/api";
import { validateGitHubSignature } from "@conductor/core";
import { createServiceClient } from "@conductor/db";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/github/webhook
 *
 * Public endpoint (no auth middleware) — security is provided entirely by
 * HMAC-SHA256 signature validation using the per-endpoint secret stored in
 * webhook_endpoints.secret.
 *
 * Flow:
 * 1. Read the raw body text (required for correct HMAC calculation).
 * 2. For every enabled GitHub webhook_endpoint, validate the signature.
 * 3. If valid and the github_event filter matches, enqueue a run via
 *    enqueue_run() and update last_triggered_at.
 * 4. Always return 200 { received: true } — never leak whether a webhook
 *    endpoint was matched, to avoid endpoint enumeration.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const traceId = generateTraceId();

  // ── Read raw body ────────────────────────────────────────────────────────
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "unreadable body" }, { status: 400 });
  }

  const signatureHeader = req.headers.get("x-hub-signature-256") ?? "";
  const githubEventHeader = req.headers.get("x-github-event") ?? "";

  // ── Load all enabled GitHub webhook endpoints ────────────────────────────
  const db = createServiceClient();

  const { data: endpoints, error: fetchErr } = await db
    .from("webhook_endpoints")
    .select("*")
    .eq("source", "github")
    .eq("enabled", true);

  if (fetchErr !== null || endpoints === null) {
    // Log the error server-side but still return 200 to avoid leaking info.
    console.error({ traceId, err: fetchErr?.message }, "webhook: failed to load endpoints");
    return NextResponse.json({ received: true });
  }

  // ── Process each endpoint ────────────────────────────────────────────────
  for (const endpoint of endpoints) {
    // Validate HMAC signature
    const valid = await validateGitHubSignature(rawBody, signatureHeader, endpoint.secret).catch(
      () => false,
    );

    if (!valid) continue;

    // Check event filter: null/empty means accept all events
    if (
      endpoint.github_event !== null &&
      endpoint.github_event !== "" &&
      endpoint.github_event !== githubEventHeader
    ) {
      continue;
    }

    // ── Enqueue a run ──────────────────────────────────────────────────────
    const { error: rpcErr } = await db.rpc("enqueue_run", {
      p_plan_id: endpoint.plan_id,
      p_user_id: endpoint.user_id,
      p_working_dir: "",
      p_triggered_by: "webhook",
    });

    if (rpcErr !== null) {
      console.error(
        { traceId, endpointId: endpoint.id, planId: endpoint.plan_id, err: rpcErr.message },
        "webhook: enqueue_run failed",
      );
      // Continue processing other endpoints even if one fails.
      continue;
    }

    // ── Update last_triggered_at ──────────────────────────────────────────
    await db
      .from("webhook_endpoints")
      .update({ last_triggered_at: new Date().toISOString() })
      .eq("id", endpoint.id)
      .then(({ error }) => {
        if (error !== null) {
          console.warn(
            { traceId, endpointId: endpoint.id, err: error.message },
            "webhook: failed to update last_triggered_at",
          );
        }
      });
  }

  return NextResponse.json({ received: true });
}

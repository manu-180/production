import { defineRoute, respond, respondError } from "@/lib/api";
import { assertRunOwned, emitRunEvent, transitionRunStatus } from "@/lib/api/run-utils";
import { type RunReasonBody, runReasonBodySchema } from "@/lib/validators/runs";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

/**
 * POST /api/runs/:id/pause — flip a running run to paused.
 *
 * The worker subscribes to `runs` UPDATE events via Supabase Realtime
 * (per-run channel in `RunControlChannel`) and reacts to this status flip
 * within ms. The orchestrator honors the pause at the next wave boundary
 * (mid-prompt cancellation would lose Claude CLI work in progress).
 *
 * If realtime is degraded, the channel's 5s reconcile poll is the fallback;
 * worst case the worker observes the pause within ~5s of the API call.
 */
export const POST = defineRoute<RunReasonBody, undefined, Params>(
  { rateLimit: "mutation", bodySchema: runReasonBodySchema },
  async ({ user, traceId, body, params }) => {
    const owned = await assertRunOwned(user.db, params.id, user.userId);
    if (owned === null) return respondError("not_found", "Run not found", { traceId });

    const updated = await transitionRunStatus(user.db, owned.id, ["running", "queued"], "paused");
    if (updated === null) {
      return respondError("conflict", `cannot pause run in status '${owned.status}'`, {
        traceId,
        details: { currentStatus: owned.status },
      });
    }

    await emitRunEvent(user.db, owned.id, "user.pause", {
      reason: body.reason ?? null,
      actor: user.userId,
    });

    return respond(updated, { traceId });
  },
);

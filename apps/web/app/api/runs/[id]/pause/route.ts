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
 * Today the worker observes status transitions on its next poll tick (the
 * RunHandler also exposes an in-memory pause() but that's only reachable
 * from the worker process). When LISTEN/NOTIFY lands, this update should
 * also `pg_notify('conductor_run_signals', <run_id>:pause)` so the worker
 * reacts within ms.
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

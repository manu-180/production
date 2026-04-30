import { defineRoute, respond, respondError } from "@/lib/api";
import { assertRunOwned, emitRunEvent, transitionRunStatus } from "@/lib/api/run-utils";
import { type RunReasonBody, runReasonBodySchema } from "@/lib/validators/runs";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

/**
 * POST /api/runs/:id/resume — bring a paused run back to running.
 * Use ?from=queued to also restart a never-started queued run (rare).
 */
export const POST = defineRoute<RunReasonBody, undefined, Params>(
  { rateLimit: "mutation", bodySchema: runReasonBodySchema },
  async ({ user, traceId, body, params }) => {
    const owned = await assertRunOwned(user.db, params.id, user.userId);
    if (owned === null) return respondError("not_found", "Run not found", { traceId });

    const updated = await transitionRunStatus(user.db, owned.id, ["paused"], "running");
    if (updated === null) {
      return respondError("conflict", `cannot resume run in status '${owned.status}'`, {
        traceId,
        details: { currentStatus: owned.status },
      });
    }

    await emitRunEvent(user.db, owned.id, "user.resume", {
      reason: body.reason ?? null,
      actor: user.userId,
    });

    return respond(updated, { traceId });
  },
);

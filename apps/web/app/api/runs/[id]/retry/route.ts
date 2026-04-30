import { defineRoute, respond, respondError } from "@/lib/api";
import { assertRunOwned, emitRunEvent } from "@/lib/api/run-utils";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

/**
 * POST /api/runs/:id/retry — re-enqueue a failed (or cancelled) run with the
 * same plan + working_dir. We do not mutate the original run — it remains as
 * an audit record; a fresh runs row gets queued and a `user.retry` event is
 * pinned to it pointing at the predecessor.
 */
export const POST = defineRoute<undefined, undefined, Params>(
  { rateLimit: "mutation" },
  async ({ user, traceId, params }) => {
    const owned = await assertRunOwned(user.db, params.id, user.userId);
    if (owned === null) return respondError("not_found", "Run not found", { traceId });

    if (!["failed", "cancelled"].includes(owned.status)) {
      return respondError("conflict", `cannot retry a run in status '${owned.status}'`, {
        traceId,
        details: { currentStatus: owned.status },
      });
    }

    const { data: newRunId, error: rpcErr } = await user.db.rpc("enqueue_run", {
      p_plan_id: owned.plan_id,
      p_user_id: user.userId,
      p_working_dir: owned.working_dir,
      p_triggered_by: "retry",
    });

    if (rpcErr !== null || typeof newRunId !== "string") {
      return respondError("internal", "Failed to enqueue retry", {
        traceId,
        details: rpcErr ? { code: rpcErr.code } : undefined,
      });
    }

    await emitRunEvent(user.db, newRunId, "user.retry", {
      previousRunId: owned.id,
      actor: user.userId,
    });

    const { data: run } = await user.db.from("runs").select("*").eq("id", newRunId).maybeSingle();
    return respond(run ?? { id: newRunId }, { status: 201, traceId });
  },
);

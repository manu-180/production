import { defineRoute, respond, respondError } from "@/lib/api";
import { assertRunOwned, emitRunEvent } from "@/lib/api/run-utils";
import { z } from "zod";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

const RetryQuerySchema = z.object({
  from: z.enum(["resume", "start"]).default("resume"),
});

type RetryQuery = z.infer<typeof RetryQuerySchema>;

/**
 * POST /api/runs/:id/retry — re-enqueue a failed (or cancelled) run with the
 * same plan + working_dir. We do not mutate the original run — it remains as
 * an audit record; a fresh runs row gets queued and a `user.retry` event is
 * pinned to it pointing at the predecessor.
 *
 * ?from=resume (default): if the previous run has a last_succeeded_prompt_index,
 *   the new run starts from the next prompt using the previous session for --resume.
 * ?from=start: always re-execute from prompt 0.
 *
 * BREAKING UX: the default changed from "start from 0" to "resume from last success".
 * Pass ?from=start to opt out.
 */
export const POST = defineRoute<undefined, RetryQuery, Params>(
  { rateLimit: "mutation", querySchema: RetryQuerySchema },
  async ({ user, traceId, params, query }) => {
    const owned = await assertRunOwned(user.db, params.id, user.userId);
    if (owned === null) return respondError("not_found", "Run not found", { traceId });

    if (!["failed", "cancelled"].includes(owned.status)) {
      return respondError("conflict", `cannot retry a run in status '${owned.status}'`, {
        traceId,
        details: { currentStatus: owned.status },
      });
    }

    let resumeFromIndex: number | null = null;
    let resumeSessionId: string | null = null;
    let mode: "resume" | "start" = "start";

    if (query.from === "resume" && owned.last_succeeded_prompt_index != null) {
      resumeFromIndex = owned.last_succeeded_prompt_index + 1;
      mode = "resume";

      // Find the prompt ID at the last succeeded index to look up its session.
      const { data: promptAtIndex } = await user.db
        .from("prompts")
        .select("id")
        .eq("plan_id", owned.plan_id)
        .eq("order_index", owned.last_succeeded_prompt_index)
        .maybeSingle();

      if (promptAtIndex) {
        const { data: lastOk } = await user.db
          .from("prompt_executions")
          .select("claude_session_id")
          .eq("run_id", owned.id)
          .eq("prompt_id", promptAtIndex.id)
          .eq("status", "succeeded")
          .order("attempt", { ascending: false })
          .limit(1)
          .maybeSingle();

        resumeSessionId = lastOk?.claude_session_id ?? null;
      }
    }

    const { data: newRunId, error: rpcErr } = await user.db.rpc("enqueue_run", {
      p_plan_id: owned.plan_id,
      p_user_id: user.userId,
      p_working_dir: owned.working_dir,
      p_triggered_by: "retry",
      p_resume_from_index: resumeFromIndex,
      p_resume_session_id: resumeSessionId,
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
      mode,
      resumeFromIndex,
    });

    const { data: run } = await user.db.from("runs").select("*").eq("id", newRunId).maybeSingle();

    return respond(
      {
        ...(run ?? { id: newRunId }),
        _meta: { mode, resumeFromIndex },
      },
      { status: 201, traceId },
    );
  },
);

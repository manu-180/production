import { defineRoute, respond, respondError } from "@/lib/api";
import { assertRunOwned, emitRunEvent } from "@/lib/api/run-utils";
import { type DecisionOverride, decisionOverrideSchema } from "@/lib/validators/runs";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
  decisionId: string;
}

/**
 * POST /api/runs/:id/decisions/:decisionId/override
 *
 * Human-in-the-loop override for a guardian decision. Writes the human's
 * response onto `guardian_decisions.human_override`, flips
 * `reviewed_by_human=true`, and (optionally) marks the corresponding
 * `prompt_executions` row as `failed` so the orchestrator's retry logic picks
 * it up on its next tick. We don't call `enqueue_run` directly — the worker
 * loop owns scheduling.
 */
export const POST = defineRoute<DecisionOverride, undefined, Params>(
  { rateLimit: "mutation", bodySchema: decisionOverrideSchema },
  async ({ user, traceId, body, params }) => {
    const owned = await assertRunOwned(user.db, params.id, user.userId);
    if (owned === null) {
      return respondError("not_found", "Run not found", { traceId });
    }

    // Pull the decision + its prompt_execution to verify ownership.
    const { data: decision } = await user.db
      .from("guardian_decisions")
      .select("id, prompt_execution_id")
      .eq("id", params.decisionId)
      .maybeSingle();
    if (decision === null) {
      return respondError("not_found", "Decision not found", { traceId });
    }

    const { data: execution } = await user.db
      .from("prompt_executions")
      .select("id, run_id, status")
      .eq("id", decision.prompt_execution_id)
      .maybeSingle();
    if (execution === null || execution.run_id !== owned.id) {
      return respondError("not_found", "Decision does not belong to this run", { traceId });
    }

    const { data: updated, error: updateErr } = await user.db
      .from("guardian_decisions")
      .update({
        human_override: body.humanResponse,
        reviewed_by_human: true,
      })
      .eq("id", params.decisionId)
      .select()
      .maybeSingle();

    if (updateErr !== null || updated === null) {
      return respondError("internal", "Failed to record override", {
        traceId,
        details: updateErr ? { code: updateErr.code } : undefined,
      });
    }

    let requeued = false;
    if (body.requeuePrompt) {
      // Mark the execution failed so the orchestrator's retry path picks it
      // up on the next worker tick. We deliberately skip statuses that are
      // already terminal-success or already pending — replaying them would be
      // surprising.
      const { data: requeueRow } = await user.db
        .from("prompt_executions")
        .update({
          status: "failed",
          error_message: "guardian rejected; awaiting requeue",
          finished_at: new Date().toISOString(),
        })
        .eq("id", execution.id)
        .in("status", ["awaiting_approval", "running", "pending"])
        .select("id")
        .maybeSingle();
      requeued = requeueRow !== null;
    }

    await emitRunEvent(
      user.db,
      owned.id,
      "user.guardian_override",
      {
        decisionId: params.decisionId,
        humanResponse: body.humanResponse,
        requeuePrompt: body.requeuePrompt,
        requeued,
        actor: user.userId,
      },
      execution.id,
    );

    return respond({ decision: updated, requeued }, { traceId });
  },
);

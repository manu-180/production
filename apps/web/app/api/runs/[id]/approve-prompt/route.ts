import { defineRoute, respond, respondError } from "@/lib/api";
import { assertRunOwned, emitRunEvent } from "@/lib/api/run-utils";
import { type ApprovePrompt, approvePromptSchema } from "@/lib/validators/runs";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

/**
 * POST /api/runs/:id/approve-prompt
 *
 * Resolve an `awaiting_approval` execution. Decision:
 *   - "approve" -> flip the execution back to `running`. The orchestrator
 *     observes the new state and continues feeding the prompt.
 *   - "reject"  -> mark the execution as `skipped` (we don't have a
 *     dedicated 'rejected' status; the orchestrator treats skip as a
 *     terminal advance just like an explicit skip-prompt call).
 *
 * Both decisions emit `user.approve_prompt` so the audit log preserves the
 * intent verbatim.
 */
export const POST = defineRoute<ApprovePrompt, undefined, Params>(
  { rateLimit: "mutation", bodySchema: approvePromptSchema },
  async ({ user, traceId, body, params }) => {
    const owned = await assertRunOwned(user.db, params.id, user.userId);
    if (owned === null) return respondError("not_found", "Run not found", { traceId });

    const { data: existing } = await user.db
      .from("prompt_executions")
      .select("id, status")
      .eq("run_id", owned.id)
      .eq("prompt_id", body.promptId)
      .maybeSingle();

    if (existing === null) {
      return respondError("not_found", "Prompt execution not found for this run", { traceId });
    }
    if (existing.status !== "awaiting_approval") {
      return respondError("conflict", "execution is not awaiting approval", {
        traceId,
        details: { currentStatus: existing.status },
      });
    }

    const targetStatus = body.decision === "approve" ? "running" : "skipped";
    const updateExtra: Record<string, unknown> = { status: targetStatus };
    if (body.decision === "reject") {
      updateExtra["finished_at"] = new Date().toISOString();
    }

    const { data: updated, error } = await user.db
      .from("prompt_executions")
      // biome-ignore lint/suspicious/noExplicitAny: structural update payload
      .update(updateExtra as any)
      .eq("id", existing.id)
      .select()
      .maybeSingle();

    if (error !== null) {
      return respondError("internal", "Failed to record decision", {
        traceId,
        details: { code: error.code },
      });
    }

    await emitRunEvent(
      user.db,
      owned.id,
      "user.approve_prompt",
      {
        promptId: body.promptId,
        decision: body.decision,
        reason: body.reason ?? null,
        actor: user.userId,
      },
      existing.id,
    );

    return respond(updated, { traceId });
  },
);

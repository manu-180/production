import { defineRoute, respond, respondError } from "@/lib/api";
import { assertRunOwned, emitRunEvent } from "@/lib/api/run-utils";
import { type SkipPrompt, skipPromptSchema } from "@/lib/validators/runs";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

/**
 * POST /api/runs/:id/skip-prompt — mark a specific prompt_execution as
 * `skipped` so the orchestrator advances past it without running Claude.
 *
 * Only allowed for executions still in `pending`, `running`, or
 * `awaiting_approval`. Once an execution has terminated, skipping is a
 * no-op and we surface a 409.
 */
export const POST = defineRoute<SkipPrompt, undefined, Params>(
  { rateLimit: "mutation", bodySchema: skipPromptSchema },
  async ({ user, traceId, body, params }) => {
    const owned = await assertRunOwned(user.db, params.id, user.userId);
    if (owned === null) return respondError("not_found", "Run not found", { traceId });

    // Identify the execution before flipping it so we can return a clean
    // 404 when the prompt is wrong, and 409 when state forbids skipping.
    const { data: existing } = await user.db
      .from("prompt_executions")
      .select("id, status")
      .eq("run_id", owned.id)
      .eq("prompt_id", body.promptId)
      .maybeSingle();

    if (existing === null) {
      return respondError("not_found", "Prompt execution not found for this run", { traceId });
    }

    const skippable = ["pending", "running", "awaiting_approval"];
    if (!skippable.includes(existing.status)) {
      return respondError("conflict", `cannot skip execution in status '${existing.status}'`, {
        traceId,
        details: { currentStatus: existing.status },
      });
    }

    const finishedAt = new Date().toISOString();
    const { data: updated, error } = await user.db
      .from("prompt_executions")
      .update({ status: "skipped", finished_at: finishedAt })
      .eq("id", existing.id)
      .select()
      .maybeSingle();

    if (error !== null) {
      return respondError("internal", "Failed to skip prompt", {
        traceId,
        details: { code: error.code },
      });
    }

    await emitRunEvent(
      user.db,
      owned.id,
      "user.skip_prompt",
      {
        promptId: body.promptId,
        reason: body.reason ?? null,
        actor: user.userId,
      },
      existing.id,
    );

    return respond(updated, { traceId });
  },
);

import { defineRoute, respond, respondError } from "@/lib/api";
import { assertRunOwned } from "@/lib/api/run-utils";
import { z } from "zod";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
  decisionId: string;
}

/**
 * PATCH /api/runs/:id/guardian/decisions/:decisionId — DEPRECATED legacy
 * override endpoint. The canonical replacement is
 * POST /api/runs/:id/decisions/:decisionId/override which adds requeue
 * semantics. This path is kept so the existing dashboard
 * (`components/guardian/decision-detail-dialog.tsx`) keeps working while we
 * migrate it.
 *
 * Bug fixed in 10.7: previously wrote `overridden_by_human` and
 * `override_response`, neither of which exist on `guardian_decisions`. The
 * actual columns are `reviewed_by_human` (bool) and `human_override` (text).
 */
const legacyOverrideSchema = z.object({
  overrideResponse: z.string().min(1).max(4000),
});
type LegacyOverride = z.infer<typeof legacyOverrideSchema>;

export const PATCH = defineRoute<LegacyOverride, undefined, Params>(
  { rateLimit: "mutation", bodySchema: legacyOverrideSchema },
  async ({ user, traceId, body, params }) => {
    const owned = await assertRunOwned(user.db, params.id, user.userId);
    if (owned === null) {
      return respondError("not_found", "Run not found", { traceId });
    }

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
      .select("id, run_id")
      .eq("id", decision.prompt_execution_id)
      .maybeSingle();
    if (execution === null || execution.run_id !== owned.id) {
      return respondError("not_found", "Decision does not belong to this run", { traceId });
    }

    const { error: updateError } = await user.db
      .from("guardian_decisions")
      .update({
        human_override: body.overrideResponse,
        reviewed_by_human: true,
      })
      .eq("id", params.decisionId);

    if (updateError !== null) {
      return respondError("internal", "Failed to record override", {
        traceId,
        details: { code: updateError.code },
      });
    }

    return respond({ success: true }, { traceId });
  },
);

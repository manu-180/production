import { defineRoute, respond, respondError } from "@/lib/api";
import { assertRunOwned } from "@/lib/api/run-utils";
import {
  EMPTY_METRICS,
  type GuardianMetrics,
  computeMetrics,
  mapDecisionRow,
} from "@/lib/guardian";

export const dynamic = "force-dynamic";

export type { GuardianMetrics };

interface Params {
  id: string;
}

/**
 * GET /api/runs/:id/guardian/metrics — aggregated guardian metrics for a run.
 *
 * Reads the columns introduced by migration 20260430000001_guardian_decisions.sql:
 * `requires_human_review` (bool), `override_response` (text), and
 * `overridden_by_human` (bool).
 */
export const GET = defineRoute<undefined, undefined, Params>(
  {},
  async ({ user, traceId, params }) => {
    const owned = await assertRunOwned(user.db, params.id, user.userId);
    if (owned === null) {
      return respondError("not_found", "Run not found", { traceId });
    }

    const { data: executions, error: execError } = await user.db
      .from("prompt_executions")
      .select("id")
      .eq("run_id", owned.id);

    if (execError !== null) {
      return respondError("internal", "Failed to load executions", {
        traceId,
        details: { code: execError.code },
      });
    }

    const executionIds = ((executions ?? []) as Array<{ id: string }>).map((e) => e.id);
    if (executionIds.length === 0) {
      return respond(EMPTY_METRICS, { traceId });
    }

    const { data: decisions, error: decisionsError } = await user.db
      .from("guardian_decisions")
      .select("strategy, confidence, requires_human_review, override_response, overridden_by_human")
      .in("prompt_execution_id", executionIds);

    if (decisionsError !== null) {
      return respondError("internal", "Failed to load decisions", {
        traceId,
        details: { code: decisionsError.code },
      });
    }

    if (decisions === null || decisions.length === 0) {
      return respond(EMPTY_METRICS, { traceId });
    }

    const rows = decisions.map((row) => mapDecisionRow(row as Record<string, unknown>));
    return respond(computeMetrics(rows), { traceId });
  },
);

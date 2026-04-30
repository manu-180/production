import { defineRoute, respond, respondError } from "@/lib/api";
import { assertRunOwned } from "@/lib/api/run-utils";
import { type GuardianDecisionRow, mapDecisionRow } from "@/lib/guardian";

export const dynamic = "force-dynamic";

export type { GuardianDecisionRow };

interface Params {
  id: string;
}

/**
 * GET /api/runs/:id/guardian/decisions — DEPRECATED legacy alias.
 *
 * Returns mapped GuardianDecisionRow[] (camelCase view-model) for the
 * dashboard's existing consumers. Prefer the canonical
 * GET /api/runs/:id/decisions which returns raw rows under
 * `{ decisions: [...] }`. This path is kept while the dashboard migrates;
 * remove once the last reference is gone.
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
      return respond([] as GuardianDecisionRow[], { traceId });
    }

    const { data: decisions, error: decisionsError } = await user.db
      .from("guardian_decisions")
      .select("*")
      .in("prompt_execution_id", executionIds)
      .order("created_at", { ascending: true });

    if (decisionsError !== null) {
      return respondError("internal", "Failed to load decisions", {
        traceId,
        details: { code: decisionsError.code },
      });
    }

    const rows = (decisions ?? []).map((row) => mapDecisionRow(row as Record<string, unknown>));
    return respond(rows, { traceId });
  },
);

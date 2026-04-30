import { defineRoute, respond, respondError } from "@/lib/api";
import { assertRunOwned } from "@/lib/api/run-utils";
import { z } from "zod";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

const decisionsListQuerySchema = z.object({
  reviewed: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});
type DecisionsListQuery = z.infer<typeof decisionsListQuerySchema>;

/**
 * GET /api/runs/:id/decisions — guardian decisions for every execution in the run.
 *
 * This is the canonical endpoint going forward. The legacy
 * `/api/runs/:id/guardian/decisions` route still exists for backwards
 * compatibility but routes through the same shape.
 *
 * Filters:
 *   - `?reviewed=true|false` — narrow to (un)reviewed decisions
 */
export const GET = defineRoute<undefined, DecisionsListQuery, Params>(
  { querySchema: decisionsListQuerySchema },
  async ({ user, traceId, query, params }) => {
    const owned = await assertRunOwned(user.db, params.id, user.userId);
    if (owned === null) {
      return respondError("not_found", "Run not found", { traceId });
    }

    const { data: executions, error: execErr } = await user.db
      .from("prompt_executions")
      .select("id")
      .eq("run_id", owned.id);

    if (execErr !== null) {
      return respondError("internal", "Failed to load executions", {
        traceId,
        details: { code: execErr.code },
      });
    }

    const executionIds = ((executions ?? []) as Array<{ id: string }>).map((e) => e.id);
    if (executionIds.length === 0) {
      return respond({ decisions: [] }, { traceId });
    }

    let q = user.db
      .from("guardian_decisions")
      .select("*")
      .in("prompt_execution_id", executionIds)
      .order("created_at", { ascending: true });

    if (query.reviewed !== undefined) {
      q = q.eq("reviewed_by_human", query.reviewed);
    }

    const { data, error } = await q;
    if (error !== null) {
      return respondError("internal", "Failed to load decisions", {
        traceId,
        details: { code: error.code },
      });
    }

    return respond({ decisions: data ?? [] }, { traceId });
  },
);

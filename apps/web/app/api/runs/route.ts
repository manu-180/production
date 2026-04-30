import { defineRoute, respond, respondError } from "@/lib/api";
import { applyCursorFilter, buildNextCursor } from "@/lib/api/pagination";
import { type RunListQuery, runListQuerySchema } from "@/lib/validators/runs";

export const dynamic = "force-dynamic";

/**
 * GET /api/runs — list the user's runs.
 * Filters: ?status=, ?planId=. Pagination: ?limit=&cursor=.
 */
export const GET = defineRoute<undefined, RunListQuery>(
  { querySchema: runListQuerySchema },
  async ({ user, traceId, query }) => {
    let q = user.db
      .from("runs")
      .select("*")
      .eq("user_id", user.userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(query.limit);

    if (query.status !== undefined) q = q.eq("status", query.status);
    if (query.planId !== undefined) q = q.eq("plan_id", query.planId);

    const { query: paged } = applyCursorFilter(q, query.cursor);

    const { data, error } = await paged;
    if (error !== null) {
      return respondError("internal", "Failed to load runs", {
        traceId,
        details: { code: error.code },
      });
    }

    const rows = data ?? [];
    return respond({ runs: rows, nextCursor: buildNextCursor(rows, query.limit) }, { traceId });
  },
);

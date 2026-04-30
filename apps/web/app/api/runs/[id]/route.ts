import { defineRoute, respond, respondError } from "@/lib/api";
import { assertRunOwned } from "@/lib/api/run-utils";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

/**
 * GET /api/runs/:id — full run with executions and the parent plan.
 * Executions are returned in order_index order via the prompt FK.
 */
export const GET = defineRoute<undefined, undefined, Params>(
  {},
  async ({ user, traceId, params }) => {
    const owned = await assertRunOwned(user.db, params.id, user.userId);
    if (owned === null) {
      return respondError("not_found", "Run not found", { traceId });
    }

    const [{ data: run }, { data: executions }, { data: plan }] = await Promise.all([
      user.db.from("runs").select("*").eq("id", owned.id).maybeSingle(),
      user.db
        .from("prompt_executions")
        .select("*, prompts!inner(order_index, title, filename)")
        .eq("run_id", owned.id),
      user.db.from("plans").select("*").eq("id", owned.plan_id).maybeSingle(),
    ]);

    // Order executions by the joined prompt's order_index. Done in JS to keep
    // the SQL straightforward (PostgREST's foreignTable ordering quirks).
    const orderedExecutions = (executions ?? []).slice().sort((a, b) => {
      const ao = (a as { prompts?: { order_index?: number } }).prompts?.order_index ?? 0;
      const bo = (b as { prompts?: { order_index?: number } }).prompts?.order_index ?? 0;
      return ao - bo;
    });

    return respond(
      {
        ...(run ?? { id: owned.id }),
        executions: orderedExecutions,
        plan: plan ?? null,
      },
      { traceId },
    );
  },
);

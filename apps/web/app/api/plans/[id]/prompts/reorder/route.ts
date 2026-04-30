import { defineRoute, respond, respondError } from "@/lib/api";
import { assertPlanOwned } from "@/lib/api/prompt-utils";
import { type PromptReorder, promptReorderSchema } from "@/lib/validators/plans";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

/**
 * POST /api/plans/:id/prompts/reorder
 *
 * Body: `{ ordered: string[] }` — every prompt id of the plan in the
 * desired order. The server enforces:
 *   1. The list contains exactly the same set of ids that already belong to
 *      the plan (no insertions, no deletions through this endpoint).
 *   2. Each id is unique in the list.
 *
 * Strategy: bump every prompt to a non-conflicting offset first, then write
 * the final order_index. The two-phase write avoids the unique-index
 * collision (`prompts_plan_id_order_index_idx`) that would otherwise fire
 * mid-update, and keeps consistency without needing a Postgres function.
 */
export const POST = defineRoute<PromptReorder, undefined, Params>(
  { rateLimit: "mutation", bodySchema: promptReorderSchema },
  async ({ user, traceId, body, params }) => {
    const plan = await assertPlanOwned(user.db, params.id, user.userId);
    if (plan === null) {
      return respondError("not_found", "Plan not found", { traceId });
    }

    const { data: existing, error: existingErr } = await user.db
      .from("prompts")
      .select("id")
      .eq("plan_id", plan.id);

    if (existingErr !== null) {
      return respondError("internal", "Failed to load existing prompts", {
        traceId,
        details: { code: existingErr.code },
      });
    }

    const existingIds = new Set((existing ?? []).map((p) => p.id));
    const orderedSet = new Set(body.ordered);

    if (orderedSet.size !== body.ordered.length) {
      return respondError("validation", "ordered must contain unique ids", { traceId });
    }
    if (orderedSet.size !== existingIds.size) {
      return respondError("validation", "ordered must list every prompt of the plan", {
        traceId,
        details: { expected: existingIds.size, received: orderedSet.size },
      });
    }
    for (const id of body.ordered) {
      if (!existingIds.has(id)) {
        return respondError("validation", "ordered contains an unknown prompt id", {
          traceId,
          details: { id },
        });
      }
    }

    // Phase 1: shove every row into a high offset (current_max + 1000 + index)
    // so the unique index can't collide while we rewrite.
    const offset = body.ordered.length + 1000;
    for (let i = 0; i < body.ordered.length; i++) {
      const id = body.ordered[i];
      if (id === undefined) continue;
      const { error } = await user.db
        .from("prompts")
        .update({ order_index: offset + i })
        .eq("id", id)
        .eq("plan_id", plan.id);
      if (error !== null) {
        return respondError("internal", "Failed to stage reorder", {
          traceId,
          details: { code: error.code, phase: "stage" },
        });
      }
    }

    // Phase 2: write the final positions.
    for (let i = 0; i < body.ordered.length; i++) {
      const id = body.ordered[i];
      if (id === undefined) continue;
      const { error } = await user.db
        .from("prompts")
        .update({ order_index: i })
        .eq("id", id)
        .eq("plan_id", plan.id);
      if (error !== null) {
        return respondError("internal", "Failed to commit reorder", {
          traceId,
          details: { code: error.code, phase: "commit" },
        });
      }
    }

    return respond({ ok: true }, { traceId });
  },
);

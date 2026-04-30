import { defineRoute, respond, respondError, respondNoContent } from "@/lib/api";
import { type PlanUpdate, planUpdateSchema } from "@/lib/validators/plans";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

/**
 * GET /api/plans/:id — return a plan with its prompts (ordered).
 */
export const GET = defineRoute<undefined, undefined, Params>(
  {},
  async ({ user, traceId, params }) => {
    const { data: plan, error } = await user.db
      .from("plans")
      .select("*")
      .eq("id", params.id)
      .eq("user_id", user.userId)
      .maybeSingle();

    if (error !== null) {
      return respondError("internal", "Failed to load plan", {
        traceId,
        details: { code: error.code },
      });
    }
    if (plan === null) {
      return respondError("not_found", "Plan not found", { traceId });
    }

    const { data: prompts, error: promptsErr } = await user.db
      .from("prompts")
      .select("*")
      .eq("plan_id", plan.id)
      .order("order_index", { ascending: true });

    if (promptsErr !== null) {
      return respondError("internal", "Failed to load prompts", {
        traceId,
        details: { code: promptsErr.code },
      });
    }

    return respond({ ...plan, prompts: prompts ?? [] }, { traceId });
  },
);

/**
 * PATCH /api/plans/:id — partial update.
 */
export const PATCH = defineRoute<PlanUpdate, undefined, Params>(
  { rateLimit: "mutation", bodySchema: planUpdateSchema },
  async ({ user, traceId, body, params }) => {
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update["name"] = body.name;
    if (body.description !== undefined) update["description"] = body.description;
    if (body.tags !== undefined) update["tags"] = body.tags;
    if (body.is_template !== undefined) update["is_template"] = body.is_template;
    if (body.default_working_dir !== undefined)
      update["default_working_dir"] = body.default_working_dir;
    if (body.default_settings !== undefined) update["default_settings"] = body.default_settings;

    const { data: plan, error } = await user.db
      .from("plans")
      // biome-ignore lint/suspicious/noExplicitAny: structural update payload
      .update(update as any)
      .eq("id", params.id)
      .eq("user_id", user.userId)
      .select()
      .maybeSingle();

    if (error !== null) {
      return respondError("internal", "Failed to update plan", {
        traceId,
        details: { code: error.code },
      });
    }
    if (plan === null) {
      return respondError("not_found", "Plan not found", { traceId });
    }
    return respond(plan, { traceId });
  },
);

/**
 * DELETE /api/plans/:id — hard delete. Prompts cascade (FK ON DELETE CASCADE).
 * Runs detach (FK ON DELETE SET NULL or similar policy on the runs side).
 */
export const DELETE = defineRoute<undefined, undefined, Params>(
  { rateLimit: "mutation" },
  async ({ user, traceId, params }) => {
    // Verify ownership before delete so we return 404 vs silently succeeding.
    const { data: existing, error: lookupErr } = await user.db
      .from("plans")
      .select("id")
      .eq("id", params.id)
      .eq("user_id", user.userId)
      .maybeSingle();

    if (lookupErr !== null) {
      return respondError("internal", "Failed to look up plan", {
        traceId,
        details: { code: lookupErr.code },
      });
    }
    if (existing === null) {
      return respondError("not_found", "Plan not found", { traceId });
    }

    const { error: delErr } = await user.db.from("plans").delete().eq("id", params.id);
    if (delErr !== null) {
      // 23503 = foreign_key_violation. The current schema declares
      // runs.plan_id WITHOUT ON DELETE SET NULL, so we surface this as a
      // conflict the caller can act on (delete/archive runs first, or wait
      // for the schema migration that detaches runs from deleted plans).
      if (delErr.code === "23503") {
        return respondError("conflict", "Plan has runs that reference it", {
          traceId,
          details: { code: delErr.code },
        });
      }
      return respondError("internal", "Failed to delete plan", {
        traceId,
        details: { code: delErr.code },
      });
    }

    return respondNoContent(traceId);
  },
);

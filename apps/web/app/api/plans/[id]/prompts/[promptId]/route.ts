import { defineRoute, respond, respondError, respondNoContent } from "@/lib/api";
import { assertPlanOwned, sha256Hex } from "@/lib/api/prompt-utils";
import { type PromptUpdate, promptUpdateSchema } from "@/lib/validators/plans";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
  promptId: string;
}

/**
 * GET /api/plans/:id/prompts/:promptId
 */
export const GET = defineRoute<undefined, undefined, Params>(
  {},
  async ({ user, traceId, params }) => {
    const plan = await assertPlanOwned(user.db, params.id, user.userId);
    if (plan === null) {
      return respondError("not_found", "Plan not found", { traceId });
    }

    const { data, error } = await user.db
      .from("prompts")
      .select("*")
      .eq("id", params.promptId)
      .eq("plan_id", plan.id)
      .maybeSingle();

    if (error !== null) {
      return respondError("internal", "Failed to load prompt", {
        traceId,
        details: { code: error.code },
      });
    }
    if (data === null) {
      return respondError("not_found", "Prompt not found", { traceId });
    }
    return respond(data, { traceId });
  },
);

/**
 * PATCH /api/plans/:id/prompts/:promptId — update content/frontmatter/title.
 * `content_hash` is recomputed when content changes.
 */
export const PATCH = defineRoute<PromptUpdate, undefined, Params>(
  { rateLimit: "mutation", bodySchema: promptUpdateSchema },
  async ({ user, traceId, body, params }) => {
    const plan = await assertPlanOwned(user.db, params.id, user.userId);
    if (plan === null) {
      return respondError("not_found", "Plan not found", { traceId });
    }

    const update: Record<string, unknown> = {};
    if (body.title !== undefined) update["title"] = body.title;
    if (body.filename !== undefined) update["filename"] = body.filename;
    if (body.frontmatter !== undefined) update["frontmatter"] = body.frontmatter;
    if (body.order_index !== undefined) update["order_index"] = body.order_index;
    if (body.content !== undefined) {
      update["content"] = body.content;
      update["content_hash"] = sha256Hex(body.content);
    }

    const { data, error } = await user.db
      .from("prompts")
      // biome-ignore lint/suspicious/noExplicitAny: structural update payload
      .update(update as any)
      .eq("id", params.promptId)
      .eq("plan_id", plan.id)
      .select()
      .maybeSingle();

    if (error !== null) {
      return respondError("internal", "Failed to update prompt", {
        traceId,
        details: { code: error.code },
      });
    }
    if (data === null) {
      return respondError("not_found", "Prompt not found", { traceId });
    }
    return respond(data, { traceId });
  },
);

/**
 * DELETE /api/plans/:id/prompts/:promptId — remove and re-pack `order_index`
 * so the remaining prompts stay contiguous (no gaps).
 *
 * Re-packing is best-effort: if it fails after the delete the data isn't lost,
 * just sparse — a follow-up reorder call would fix it. We log nothing here
 * because `defineRoute()` already wraps unhandled errors.
 */
export const DELETE = defineRoute<undefined, undefined, Params>(
  { rateLimit: "mutation" },
  async ({ user, traceId, params }) => {
    const plan = await assertPlanOwned(user.db, params.id, user.userId);
    if (plan === null) {
      return respondError("not_found", "Plan not found", { traceId });
    }

    const { data: existing, error: lookupErr } = await user.db
      .from("prompts")
      .select("id, order_index")
      .eq("id", params.promptId)
      .eq("plan_id", plan.id)
      .maybeSingle();

    if (lookupErr !== null) {
      return respondError("internal", "Failed to look up prompt", {
        traceId,
        details: { code: lookupErr.code },
      });
    }
    if (existing === null) {
      return respondError("not_found", "Prompt not found", { traceId });
    }

    const { error: delErr } = await user.db
      .from("prompts")
      .delete()
      .eq("id", params.promptId)
      .eq("plan_id", plan.id);

    if (delErr !== null) {
      return respondError("internal", "Failed to delete prompt", {
        traceId,
        details: { code: delErr.code },
      });
    }

    // Re-pack siblings whose order_index sits above the removed one.
    // We pull them, decrement in-memory, and write back as a single update batch.
    const { data: shifted } = await user.db
      .from("prompts")
      .select("id, order_index")
      .eq("plan_id", plan.id)
      .gt("order_index", existing.order_index)
      .order("order_index", { ascending: true });

    if (shifted !== null) {
      for (const row of shifted) {
        await user.db
          .from("prompts")
          .update({ order_index: row.order_index - 1 })
          .eq("id", row.id);
      }
    }

    return respondNoContent(traceId);
  },
);

import { defineRoute, respond, respondError } from "@/lib/api";
import { assertPlanOwned, nextOrderIndex, sha256Hex } from "@/lib/api/prompt-utils";
import { type PromptInput, promptCreateSchema } from "@/lib/validators/plans";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

/**
 * GET /api/plans/:id/prompts — list prompts of a plan in order.
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
      .eq("plan_id", plan.id)
      .order("order_index", { ascending: true });

    if (error !== null) {
      return respondError("internal", "Failed to load prompts", {
        traceId,
        details: { code: error.code },
      });
    }
    return respond({ prompts: data ?? [] }, { traceId });
  },
);

/**
 * POST /api/plans/:id/prompts — append (or insert at given order_index) a prompt.
 */
export const POST = defineRoute<PromptInput, undefined, Params>(
  { rateLimit: "mutation", bodySchema: promptCreateSchema },
  async ({ user, traceId, body, params }) => {
    const plan = await assertPlanOwned(user.db, params.id, user.userId);
    if (plan === null) {
      return respondError("not_found", "Plan not found", { traceId });
    }

    const orderIndex = body.order_index ?? (await nextOrderIndex(user.db, plan.id));

    const { data, error } = await user.db
      .from("prompts")
      .insert({
        plan_id: plan.id,
        order_index: orderIndex,
        filename: body.filename ?? null,
        title: body.title ?? null,
        content: body.content,
        content_hash: sha256Hex(body.content),
        frontmatter: (body.frontmatter ?? {}) as never,
      })
      .select()
      .single();

    if (error !== null || data === null) {
      return respondError("internal", "Failed to create prompt", {
        traceId,
        details: error ? { code: error.code } : undefined,
      });
    }
    return respond(data, { status: 201, traceId });
  },
);

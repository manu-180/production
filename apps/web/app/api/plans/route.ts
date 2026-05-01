import { createHash } from "node:crypto";
import { defineRoute, respond, respondError } from "@/lib/api";
import { applyCursorFilter, buildNextCursor } from "@/lib/api/pagination";
import {
  type PlanCreate,
  type PlanListQuery,
  planCreateSchema,
  planListQuerySchema,
} from "@/lib/validators/plans";
import { AuditLogger, type DbClient } from "@conductor/core";
import { createServiceClient } from "@conductor/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/plans — list plans owned by the user.
 * Filters: ?tag=<tag>, ?search=<text> (matches name), ?is_template=true|false.
 * Pagination: ?limit=20&cursor=<opaque>.
 */
export const GET = defineRoute<undefined, PlanListQuery>(
  { querySchema: planListQuerySchema },
  async ({ user, traceId, query }) => {
    let q = user.db
      .from("plans")
      .select("*")
      .eq("user_id", user.userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(query.limit);

    if (query.tag !== undefined) q = q.contains("tags", [query.tag]);
    if (query.search !== undefined) q = q.ilike("name", `%${query.search}%`);
    if (query.is_template !== undefined) q = q.eq("is_template", query.is_template);

    const { query: paged } = applyCursorFilter(q, query.cursor);

    const { data, error } = await paged;
    if (error !== null) {
      return respondError("internal", "Failed to load plans", {
        traceId,
        details: { code: error.code },
      });
    }

    const rows = data ?? [];
    return respond(
      {
        plans: rows,
        nextCursor: buildNextCursor(rows, query.limit),
      },
      { traceId },
    );
  },
);

/**
 * POST /api/plans — create a plan, optionally with prompts.
 *
 * If `prompts` are supplied we insert them in a single batch after the plan.
 * `content_hash` is computed server-side (SHA-256 of body) and `order_index`
 * defaults to the supplied position when missing. We don't wrap this in a
 * transaction — if the prompt insert fails we delete the freshly-created
 * plan to keep the API contract atomic from the caller's perspective.
 */
export const POST = defineRoute<PlanCreate>(
  { rateLimit: "mutation", bodySchema: planCreateSchema },
  async ({ user, traceId, body }) => {
    const { data: plan, error: planErr } = await user.db
      .from("plans")
      .insert({
        user_id: user.userId,
        name: body.name,
        description: body.description ?? null,
        tags: body.tags ?? [],
        is_template: body.is_template ?? false,
        default_working_dir: body.default_working_dir ?? null,
        // `default_settings` column is `jsonb` (typed as Json by codegen).
        // The zod schema accepts `Record<string, unknown>` which is assignable
        // at runtime but not at compile time without the cast.
        default_settings: (body.default_settings ?? {}) as never,
      })
      .select()
      .single();

    if (planErr !== null || plan === null) {
      return respondError("internal", "Failed to create plan", {
        traceId,
        details: planErr ? { code: planErr.code } : undefined,
      });
    }

    const svc = createServiceClient();
    const audit = new AuditLogger(svc as unknown as DbClient);
    void audit.log({
      actor: "user",
      action: "plan.created",
      userId: user.userId,
      resourceType: "plan",
      resourceId: plan.id,
      metadata: { name: body.name },
    });

    if (body.prompts === undefined || body.prompts.length === 0) {
      return respond({ ...plan, prompts: [] }, { status: 201, traceId });
    }

    const promptRows = body.prompts.map((p, idx) => ({
      plan_id: plan.id,
      order_index: p.order_index ?? idx,
      filename: p.filename ?? null,
      title: p.title ?? null,
      content: p.content,
      content_hash: sha256Hex(p.content),
      frontmatter: (p.frontmatter ?? {}) as never,
    }));

    const { data: prompts, error: promptsErr } = await user.db
      .from("prompts")
      .insert(promptRows)
      .select()
      .order("order_index", { ascending: true });

    if (promptsErr !== null) {
      // Best-effort cleanup so the plan doesn't linger half-populated.
      await user.db.from("plans").delete().eq("id", plan.id);
      return respondError("internal", "Failed to create plan prompts", {
        traceId,
        details: { code: promptsErr.code },
      });
    }

    return respond({ ...plan, prompts: prompts ?? [] }, { status: 201, traceId });
  },
);

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

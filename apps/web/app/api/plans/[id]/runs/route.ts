import { defineRoute, respond, respondError } from "@/lib/api";
import { assertPlanOwned } from "@/lib/api/prompt-utils";
import { type RunTrigger, runTriggerSchema } from "@/lib/validators/runs";
import { AuditLogger, type DbClient } from "@conductor/core";
import { createServiceClient } from "@conductor/db";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

/**
 * POST /api/plans/:id/runs — enqueue a run for a plan.
 *
 * Calls the `enqueue_run` SQL function which atomically inserts the runs row
 * (status='queued'), creates one prompt_executions row per prompt, and emits
 * `pg_notify('conductor_runs_queued', <run_id>)` so a future LISTEN-based
 * worker can pick the run up immediately. Today's polling worker also
 * notices on its next tick.
 *
 * `dryRun: true` skips the insert entirely and returns the prompts that
 * would have been scheduled — handy for showing the user what will execute
 * before they commit. `settingsOverride` is reserved for future use; the
 * current `enqueue_run` doesn't accept overrides, so we ignore it for now
 * and return a hint in the response.
 */
export const POST = defineRoute<RunTrigger, undefined, Params>(
  { rateLimit: "mutation", bodySchema: runTriggerSchema },
  async ({ user, traceId, body, params, req }) => {
    const plan = await assertPlanOwned(user.db, params.id, user.userId);
    if (plan === null) {
      return respondError("not_found", "Plan not found", { traceId });
    }

    // Confirm the plan has prompts. Triggering a run on an empty plan would
    // succeed but immediately complete with zero work, which is rarely useful
    // and almost always a bug — surface it.
    const { data: anyPrompt } = await user.db
      .from("prompts")
      .select("id")
      .eq("plan_id", plan.id)
      .limit(1)
      .maybeSingle();
    if (anyPrompt === null) {
      return respondError("conflict", "Plan has no prompts to execute", { traceId });
    }

    if (body.dryRun === true) {
      const { data: prompts } = await user.db
        .from("prompts")
        .select("id, order_index, title, filename")
        .eq("plan_id", plan.id)
        .order("order_index", { ascending: true });
      return respond(
        {
          dryRun: true,
          plan_id: plan.id,
          working_dir: body.workingDir,
          prompts: prompts ?? [],
          warnings:
            body.settingsOverride !== undefined
              ? ["settingsOverride is accepted but not yet honored by enqueue_run"]
              : [],
        },
        { traceId },
      );
    }

    // Idempotency-Key is recorded in the audit event so a future migration
    // can add a partial unique index on (user_id, event_type, payload->>'key')
    // and turn this into a real dedupe. For now we just propagate the key.
    // TODO(10.x): wire actual dedupe once we have a proper idempotency_keys
    // table with a TTL index.
    const idemKey = req.headers.get("idempotency-key");

    const { data: runId, error: rpcErr } = await user.db.rpc("enqueue_run", {
      p_plan_id: plan.id,
      p_user_id: user.userId,
      p_working_dir: body.workingDir,
      p_triggered_by: "manual",
    });

    if (rpcErr !== null || typeof runId !== "string") {
      return respondError("internal", "Failed to enqueue run", {
        traceId,
        details: rpcErr ? { code: rpcErr.code, message: rpcErr.message } : undefined,
      });
    }

    // Audit event for the trigger; carries the idempotency key when present.
    await user.db.from("run_events").insert({
      run_id: runId,
      sequence: 0,
      event_type: "user.trigger",
      payload: {
        idempotencyKey: idemKey,
        workingDir: body.workingDir,
        triggeredBy: user.userId,
      } as never,
    });

    const { data: run } = await user.db.from("runs").select("*").eq("id", runId).maybeSingle();
    const svc = createServiceClient();
    const audit = new AuditLogger(svc as unknown as DbClient);
    void audit.log({
      actor: "user",
      action: "run.launched",
      userId: user.userId,
      resourceType: "run",
      resourceId: runId,
      metadata: { planId: plan.id, workingDir: body.workingDir },
    });
    return respond(run ?? { id: runId }, { status: 201, traceId });
  },
);

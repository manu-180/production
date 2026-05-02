import { defineRoute, respond, respondError } from "@/lib/api";
import { assertRunOwned, emitRunEvent, transitionRunStatus } from "@/lib/api/run-utils";
import { type RunCancel, runCancelSchema } from "@/lib/validators/runs";
import { AuditLogger, type GuardianDbClient } from "@conductor/core";
import { createServiceClient } from "@conductor/db";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

/**
 * POST /api/runs/:id/cancel — terminal stop. Allowed from queued/running/paused.
 *
 * `cancellation_reason` is required to keep the audit trail meaningful.
 * The orchestrator's `PauseController.cancel()` reaches the same end state
 * inside the worker; here we update DB-side and let the worker observe.
 */
export const POST = defineRoute<RunCancel, undefined, Params>(
  { rateLimit: "mutation", bodySchema: runCancelSchema },
  async ({ user, traceId, body, params }) => {
    const owned = await assertRunOwned(user.db, params.id, user.userId);
    if (owned === null) return respondError("not_found", "Run not found", { traceId });

    const updated = await transitionRunStatus(
      user.db,
      owned.id,
      ["queued", "running", "paused"],
      "cancelled",
      { cancellation_reason: body.reason, finished_at: new Date().toISOString() },
    );
    if (updated === null) {
      return respondError("conflict", `cannot cancel run in status '${owned.status}'`, {
        traceId,
        details: { currentStatus: owned.status },
      });
    }

    await emitRunEvent(user.db, owned.id, "user.cancel", {
      reason: body.reason,
      actor: user.userId,
    });

    const svc = createServiceClient();
    const audit = new AuditLogger(svc as unknown as GuardianDbClient);
    void audit.log({
      actor: "user",
      action: "run.cancelled",
      userId: user.userId,
      resourceType: "run",
      resourceId: owned.id,
      metadata: { reason: body.reason },
    });
    return respond(updated, { traceId });
  },
);

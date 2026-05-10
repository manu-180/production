import { defineRoute, respond, respondError } from "@/lib/api";
import { assertRunOwned, emitRunEvent, transitionRunStatus } from "@/lib/api/run-utils";
import { type RunReasonBody, runReasonBodySchema } from "@/lib/validators/runs";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

// A run is considered "owned by a live worker" if its last heartbeat
// arrived within this many ms. The worker heartbeat tick is 10s; we triple
// it to absorb missed ticks (slow DB write, transient network) without
// falsely declaring the worker dead.
const WORKER_ALIVE_THRESHOLD_MS = 30_000;

/**
 * POST /api/runs/:id/resume — bring a paused run back to running.
 *
 * Two paths:
 *   1. **Hot resume (worker alive):** the run's heartbeat is fresh, so a
 *      worker is still holding the orchestrator in memory. We flip status
 *      to `running`; the worker's `RunControlChannel` observes the change
 *      via Realtime and calls `orchestrator.resume()`, which unblocks the
 *      `PauseController.waitIfPaused()` deferred between waves.
 *   2. **Cold resume (no live worker):** if the run was paused by crash
 *      recovery (worker died while running, see startup-recovery) the
 *      orchestrator no longer exists in memory. Flipping to `running`
 *      would leave the row stranded — `checkForQueuedRuns()` only picks
 *      up `queued`. We detect this by checking `last_heartbeat_at` age
 *      and re-enqueue instead. The orchestrator's resume-from-checkpoint
 *      logic picks up where the prior run left off (see
 *      `last_succeeded_prompt_index` + `resume_session_id`).
 */
export const POST = defineRoute<RunReasonBody, undefined, Params>(
  { rateLimit: "mutation", bodySchema: runReasonBodySchema },
  async ({ user, traceId, body, params }) => {
    const owned = await assertRunOwned(user.db, params.id, user.userId);
    if (owned === null) return respondError("not_found", "Run not found", { traceId });

    if (owned.status !== "paused") {
      return respondError("conflict", `cannot resume run in status '${owned.status}'`, {
        traceId,
        details: { currentStatus: owned.status },
      });
    }

    // Inspect the heartbeat to decide hot vs cold path.
    const { data: hbRow } = await user.db
      .from("runs")
      .select("last_heartbeat_at, last_succeeded_prompt_index, resume_session_id")
      .eq("id", owned.id)
      .maybeSingle();

    const hb = (hbRow ?? {}) as {
      last_heartbeat_at: string | null;
      last_succeeded_prompt_index: number | null;
      resume_session_id: string | null;
    };
    const heartbeatAgeMs =
      hb.last_heartbeat_at === null
        ? Number.POSITIVE_INFINITY
        : Date.now() - new Date(hb.last_heartbeat_at).getTime();
    const workerAlive = heartbeatAgeMs <= WORKER_ALIVE_THRESHOLD_MS;

    // Cold resume: also set resume_from_index so the next worker pickup
    // skips prompts that were already committed. last_succeeded_prompt_index
    // is the highest committed index; resume from the next one. If null
    // (nothing succeeded yet) we resume from 0, i.e. start over.
    const transitionExtra: Record<string, unknown> = {};
    if (!workerAlive) {
      const lastIdx = hb.last_succeeded_prompt_index;
      transitionExtra["resume_from_index"] =
        typeof lastIdx === "number" && lastIdx >= 0 ? lastIdx + 1 : 0;
      // Preserve any prior resume_session_id; orchestrator clears it after use.
      transitionExtra["resume_session_id"] = hb.resume_session_id ?? null;
    }

    const targetStatus = workerAlive ? "running" : "queued";
    const updated = await transitionRunStatus(
      user.db,
      owned.id,
      ["paused"],
      targetStatus,
      transitionExtra,
    );
    if (updated === null) {
      // Lost a race with another transition (e.g. user clicked cancel
      // between our SELECT and UPDATE). Surface the actual current state.
      const { data: latest } = await user.db
        .from("runs")
        .select("status")
        .eq("id", owned.id)
        .maybeSingle();
      const currentStatus =
        latest !== null && latest !== undefined
          ? ((latest as { status: string }).status ?? owned.status)
          : owned.status;
      return respondError("conflict", `cannot resume run in status '${currentStatus}'`, {
        traceId,
        details: { currentStatus },
      });
    }

    await emitRunEvent(user.db, owned.id, "user.resume", {
      reason: body.reason ?? null,
      actor: user.userId,
      cold: !workerAlive,
      heartbeat_age_ms: Number.isFinite(heartbeatAgeMs) ? heartbeatAgeMs : null,
    });

    return respond(updated, { traceId });
  },
);

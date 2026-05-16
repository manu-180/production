import { logger } from "../logger.js";
import type { DbClient } from "../orchestrator/orchestrator.js";

const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * Cold-start grace period during which the heartbeat ticks even with no
 * stdout/stderr activity. Closes the gap where Claude CLI's first output
 * line lands well after process spawn (20-60s on Windows with MCP) — the
 * orphan-sweeper's 90s stale threshold would otherwise reap a healthy
 * cold-starting process. After this window we trust stdout activity to
 * keep the heartbeat fresh.
 */
const COLD_START_GRACE_MS = 60_000;

export interface PromptHeartbeat {
  notifyActivity(): void;
  stop(): void;
}

/**
 * Starts an interval that updates prompt_executions.last_progress_at every 5s
 * only if there was stdout/stderr activity since the last tick (with a
 * cold-start grace window that always writes regardless).
 *
 * Behavior:
 *  - Immediate first write so `last_progress_at` is fresh from t=0 (the
 *    interval used to wait 5s, leaving a tiny window where the row's NULL
 *    `last_progress_at` looked stale to the sweeper).
 *  - For the first {@link COLD_START_GRACE_MS} milliseconds the heartbeat
 *    writes on every tick regardless of activity, so a quiet cold-start
 *    doesn't trip the stale-heartbeat reaper.
 *  - After the grace window, ticks are skipped when there was no stdout
 *    activity since the last tick — gives startup-recovery a clean signal
 *    that a process has genuinely stalled.
 *  - Activity is only "consumed" on successful writes; transient DB
 *    errors no longer drop the activity flag, so the next tick retries
 *    instead of silently skipping.
 */
export function startPromptHeartbeat(db: DbClient, promptExecutionId: string): PromptHeartbeat {
  let activitySinceLastTick = true;
  const startedAt = Date.now();

  const write = async (): Promise<void> => {
    try {
      const { error } = await db
        .from("prompt_executions")
        .update({ last_progress_at: new Date().toISOString() })
        .eq("id", promptExecutionId);
      if (error) {
        logger.warn({ err: error, promptExecutionId }, "prompt-heartbeat.update_failed");
        return; // keep activitySinceLastTick true so we retry next tick
      }
      activitySinceLastTick = false;
    } catch (err) {
      logger.warn({ err, promptExecutionId }, "prompt-heartbeat.update_threw");
    }
  };

  // Fire-and-forget initial write so last_progress_at is fresh from t=0.
  void write();

  const handle = setInterval(() => {
    const inColdStart = Date.now() - startedAt < COLD_START_GRACE_MS;
    if (!activitySinceLastTick && !inColdStart) return;
    void write();
  }, HEARTBEAT_INTERVAL_MS);

  return {
    notifyActivity(): void {
      activitySinceLastTick = true;
    },
    stop(): void {
      clearInterval(handle);
    },
  };
}

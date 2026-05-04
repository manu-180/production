import { logger } from "../logger.js";
import type { DbClient } from "../orchestrator/orchestrator.js";

const HEARTBEAT_INTERVAL_MS = 5_000;

export interface PromptHeartbeat {
  notifyActivity(): void;
  stop(): void;
}

/**
 * Starts an interval that updates prompt_executions.last_progress_at every 5s
 * only if there was stdout/stderr activity since the last tick.
 * With no activity the update is skipped, letting startup-recovery detect stalls.
 */
export function startPromptHeartbeat(db: DbClient, promptExecutionId: string): PromptHeartbeat {
  let activitySinceLastTick = true; // initial true → first tick always updates

  const handle = setInterval(() => {
    void (async () => {
      try {
        if (!activitySinceLastTick) return;
        activitySinceLastTick = false;
        const { error } = await db
          .from("prompt_executions")
          .update({ last_progress_at: new Date().toISOString() })
          .eq("id", promptExecutionId);
        if (error) {
          logger.warn({ err: error, promptExecutionId }, "prompt-heartbeat.update_failed");
        }
      } catch (err) {
        logger.warn({ err, promptExecutionId }, "prompt-heartbeat.update_threw");
      }
    })();
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

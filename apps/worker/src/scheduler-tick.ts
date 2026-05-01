/**
 * Conductor — Scheduler Tick
 *
 * Wires {@link ScheduleRunner} into the worker process as a recurring
 * 30-second interval. Each tick polls the `schedules` table for due schedules
 * and enqueues plan runs via the `enqueue_run` Postgres function.
 *
 * Usage:
 *   const stopSchedulerTick = startSchedulerTick(supabase, logger);
 *   // … on shutdown:
 *   stopSchedulerTick();
 */

import { ScheduleRunner } from "@conductor/core";
import type { SchedulerSupabaseClient } from "@conductor/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";

/** Interval between scheduler ticks (milliseconds). */
const SCHEDULER_INTERVAL_MS = 30_000;

/**
 * Start the scheduler tick loop.
 *
 * Creates a {@link ScheduleRunner}, schedules `runner.tick()` every 30
 * seconds, and returns a cleanup function that clears the interval so the
 * worker can shut down cleanly.
 *
 * Tick errors are handled internally by {@link ScheduleRunner} — this
 * function never rejects and the interval is never self-cancelling.
 *
 * @param supabase  Service-role Supabase client (needs read/write on
 *                  `schedules`, `runs`, and `settings` tables).
 * @param logger    Worker-level pino logger instance.
 * @returns         Cleanup function — call it on SIGTERM/SIGINT.
 */
export function startSchedulerTick(supabase: SupabaseClient, logger: Logger): () => void {
  // The real SupabaseClient satisfies SchedulerSupabaseClient structurally at
  // runtime, but Supabase's generic types don't align with the narrower
  // interface. This cast mirrors the pattern used in startup-recovery.ts.
  const runner = new ScheduleRunner(supabase as unknown as SchedulerSupabaseClient, logger);

  logger.info({ intervalMs: SCHEDULER_INTERVAL_MS }, "scheduler tick started (30s interval)");

  const handle = setInterval(() => {
    void runner.tick().then((result) => {
      if (result.enqueued > 0) {
        logger.info(
          { enqueued: result.enqueued, skipped: result.skipped, errors: result.errors },
          "[Scheduler] tick complete — runs enqueued",
        );
      } else {
        logger.debug(
          { processed: result.processed, skipped: result.skipped, errors: result.errors },
          "[Scheduler] tick complete — nothing enqueued",
        );
      }
    });
  }, SCHEDULER_INTERVAL_MS);

  return () => {
    clearInterval(handle);
    logger.info("scheduler tick stopped");
  };
}

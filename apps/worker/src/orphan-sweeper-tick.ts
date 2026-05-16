/**
 * Conductor — Periodic Orphan Sweeper Tick
 *
 * Runs the same DB-level recovery as {@link runStartupRecovery}, but on a
 * recurring interval inside a live worker. Closes the gap where:
 *  1. A worker crashes mid-run.
 *  2. No new worker boots (process supervisor down, or this was the only
 *     worker on the host and the user hasn't restarted it).
 *  3. The `runs` row stays `status='running'` forever and the dashboard
 *     reports it as live indefinitely.
 *
 * Differences from boot recovery:
 *  - Does NOT kill claude.exe processes — those belong to in-flight prompts
 *    on this worker. Cleanup of leaked processes happens only at boot.
 *  - Excludes the run IDs this worker currently owns so a just-claimed run
 *    whose first heartbeat hasn't landed isn't falsely flagged as stale.
 *
 * Wires up the same way as `startSchedulerTick` — call once during boot,
 * keep the returned cleanup function for graceful shutdown.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { runStartupRecovery } from "./startup-recovery.js";

/**
 * Interval between sweeps. 30s is short enough that a crashed run shows up
 * as `paused` within ~1 min, and long enough that the DB cost is negligible.
 */
const ORPHAN_SWEEP_INTERVAL_MS = 30_000;

/**
 * Staleness threshold for the periodic sweep. Wider than the boot-time
 * threshold so we don't race the worker's 10s HealthMonitor tick under
 * transient DB latency. A real crash will sit stale far longer than this.
 */
const ORPHAN_SWEEP_STALE_MS = 90_000;

export interface OrphanSweeperOptions {
  /**
   * Returns the set of run IDs the worker currently owns. Called fresh each
   * tick so newly-claimed / completed runs are reflected without restart.
   */
  getActiveRunIds: () => ReadonlySet<string>;
  /** Override the interval (mostly for tests). */
  intervalMs?: number;
  /** Override the staleness threshold (mostly for tests). */
  staleMs?: number;
}

/**
 * Start the periodic orphan sweep.
 *
 * Returns a cleanup function — call on SIGTERM/SIGINT to stop ticking.
 * Tick errors are caught and logged so a transient DB failure cannot kill
 * the interval.
 */
export function startOrphanSweeperTick(
  supabase: SupabaseClient,
  logger: Logger,
  opts: OrphanSweeperOptions,
): () => void {
  const intervalMs = opts.intervalMs ?? ORPHAN_SWEEP_INTERVAL_MS;
  const staleMs = opts.staleMs ?? ORPHAN_SWEEP_STALE_MS;

  logger.info({ intervalMs, staleMs }, "orphan-sweeper-tick started");

  const tick = async (): Promise<void> => {
    try {
      const excludeRunIds = opts.getActiveRunIds();
      const result = await runStartupRecovery(supabase, logger, {
        staleMs,
        excludeRunIds,
        killOrphanProcesses: false,
      });
      if (result.recovered.length > 0) {
        logger.warn(
          { count: result.recovered.length, runIds: result.recovered },
          "orphan-sweeper-tick: recovered stale runs",
        );
      }
    } catch (err) {
      logger.error({ err }, "orphan-sweeper-tick: tick threw");
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);

  return () => {
    clearInterval(handle);
    logger.info("orphan-sweeper-tick stopped");
  };
}

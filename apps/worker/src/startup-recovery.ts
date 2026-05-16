/**
 * Conductor — Worker Startup Recovery
 *
 * On boot, sweep the `runs` table for orphans (status='running' with stale
 * heartbeat) and flip them to `paused` with cancellation_reason
 * 'worker_crash_recovery'. See `@conductor/core/recovery/crash-recovery` for
 * the underlying logic.
 *
 * Also used by the periodic in-process sweeper (see `orphan-sweeper-tick.ts`)
 * so a worker crash mid-run can be recovered without waiting for the worker
 * process to be restarted. The periodic caller passes an `excludeRunIds`
 * set so runs this worker currently owns are never reaped by mistake (a
 * just-claimed run whose first heartbeat hasn't landed yet would otherwise
 * be visible to the sweeper).
 *
 * Always best-effort: a failure here logs and exits so worker boot can
 * continue.
 */

import {
  type RecoveryDbClient,
  type ResumeDbClient,
  recoverOrphanedRuns,
  resumeRun,
} from "@conductor/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { cleanupOrphanClaudeProcesses } from "./lib/orphan-cleanup.js";

export const STALE_HEARTBEAT_THRESHOLD_MS = 2 * 60 * 1000;

export interface ReapStalePromptExecutionsOptions {
  /**
   * Run IDs the caller currently owns. Their `prompt_executions` rows are
   * not eligible for reaping even if the heartbeat looks stale — the owning
   * worker's HealthMonitor will catch up shortly. Pass an empty set (or omit)
   * at boot, when nothing is owned yet.
   */
  excludeRunIds?: ReadonlySet<string>;
  /** Override the default 2-minute staleness threshold (mostly for tests). */
  staleMs?: number;
}

/**
 * Reap `prompt_executions` rows in `running` state whose `last_progress_at`
 * is older than the staleness threshold. The matching execution is marked
 * `failed` with `error_code='STALE_HEARTBEAT'`, and its parent `runs` row
 * is flipped to `paused` with `cancellation_reason='worker_crash_recovery'`
 * so the user can resume it manually.
 *
 * Previously the parent was flipped to `failed` (terminal), which made
 * crashed runs unrecoverable. `paused` matches `recoverOrphanedRuns` and
 * keeps the run resumable.
 *
 * Returns the number of executions reaped. Errors are logged and turned
 * into 0 — this function never throws.
 */
export async function reapStalePromptExecutions(
  supabase: SupabaseClient,
  logger: Logger,
  opts: ReapStalePromptExecutionsOptions = {},
): Promise<number> {
  const staleMs = opts.staleMs ?? STALE_HEARTBEAT_THRESHOLD_MS;
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  const exclude = opts.excludeRunIds ?? new Set<string>();

  let query = supabase
    .from("prompt_executions")
    .update({
      status: "failed",
      error_code: "STALE_HEARTBEAT",
      error_message: `No heartbeat for >${staleMs / 1000}s`,
      finished_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("last_progress_at", cutoff);

  if (exclude.size > 0) {
    // PostgREST `not.in.(a,b,c)` — UUIDs are URL-safe so no escaping needed.
    const ids = Array.from(exclude).join(",");
    query = query.not("run_id", "in", `(${ids})`);
  }

  const { data, error } = await query.select("id, run_id");

  if (error) {
    logger.error({ err: error }, "startup-recovery.reap_stale.failed");
    return 0;
  }

  if (data && data.length > 0) {
    logger.warn({ count: data.length, items: data }, "startup-recovery.reaped_stale_prompts");

    const runIds = Array.from(new Set(data.map((r: { run_id: string }) => r.run_id)));
    for (const runId of runIds) {
      // Flip parent run to `paused` so the user can resume. CAS guard
      // (`WHERE status='running'`) prevents stomping a status that another
      // sweeper or the worker itself just transitioned.
      await supabase
        .from("runs")
        .update({
          status: "paused",
          cancellation_reason: "worker_crash_recovery",
          finished_at: null,
        })
        .eq("id", runId)
        .eq("status", "running");
    }
  }

  return data?.length ?? 0;
}

export interface StartupRecoveryOptions {
  staleMs?: number;
  /**
   * Run IDs the current worker owns. Passed through to both
   * `reapStalePromptExecutions` and `recoverOrphanedRuns` so the periodic
   * sweeper doesn't touch live work. Defaults to empty (correct for boot).
   */
  excludeRunIds?: ReadonlySet<string>;
  /**
   * When true (boot), kill every claude.exe on the host because no
   * legitimate one should exist yet. The periodic sweeper passes false —
   * killing claude.exe in-flight would terminate active prompts.
   */
  killOrphanProcesses?: boolean;
}

export interface StartupRecoveryResult {
  recovered: string[];
  errored: string[];
}

/**
 * Run the orphan sweep. Safe to call multiple times; idempotent at the DB
 * level because each transition is gated by `WHERE status='running'`.
 */
export async function runStartupRecovery(
  supabase: SupabaseClient,
  logger: Logger,
  opts: StartupRecoveryOptions = {},
): Promise<StartupRecoveryResult> {
  const killOrphanProcesses = opts.killOrphanProcesses ?? true;
  if (killOrphanProcesses) {
    // Kill any orphan claude processes left from a previous worker crash.
    // Only safe at boot — calling this mid-run would kill our own children.
    await cleanupOrphanClaudeProcesses();
  }

  const db = supabase as unknown as RecoveryDbClient;
  const recoveryLogger = {
    info: (obj: unknown, msg?: string) => {
      if (msg !== undefined) logger.info(obj as object, msg);
      else logger.info(obj as object);
    },
    warn: (obj: unknown, msg?: string) => {
      if (msg !== undefined) logger.warn(obj as object, msg);
      else logger.warn(obj as object);
    },
    error: (obj: unknown, msg?: string) => {
      if (msg !== undefined) logger.error(obj as object, msg);
      else logger.error(obj as object);
    },
  };

  try {
    const reapOpts: ReapStalePromptExecutionsOptions = {};
    if (opts.excludeRunIds) reapOpts.excludeRunIds = opts.excludeRunIds;
    // Propagate the caller's stale threshold so the prompt-execution reaper
    // uses the same window as the run-level recovery. Without this, a
    // 90s-staleMs sweep call still used the hard-coded 120s threshold for
    // the prompt_executions side, creating an asymmetry between the two
    // tables — one half of a crash got reaped before the other.
    if (typeof opts.staleMs === "number") reapOpts.staleMs = opts.staleMs;
    await reapStalePromptExecutions(supabase, logger, reapOpts);
    const result = await recoverOrphanedRuns(db, {
      staleMs: opts.staleMs ?? 60_000,
      logger: recoveryLogger,
      ...(opts.excludeRunIds ? { excludeRunIds: opts.excludeRunIds } : {}),
    });
    if (result.recovered.length > 0) {
      logger.info(
        { count: result.recovered.length, runIds: result.recovered },
        "startup recovery: orphaned runs paused",
      );
      // Auto-re-queue: previously, recovered runs sat in `paused` forever
      // waiting for a human to click "resume". That was the dominant cause
      // of long plans aborting at ~60/360 prompts — any transient worker
      // restart paused the run and nothing picked it back up. We only
      // auto-resume at BOOT recovery (killOrphanProcesses=true), never
      // during the periodic in-process sweep — the periodic sweep can
      // legitimately reap a run whose orchestrator is still wrapping up
      // (e.g. heartbeat fell behind during checkpoint commit), and
      // re-queueing it would double-execute. Boot is the safe moment:
      // there are no orchestrators in flight yet.
      if (killOrphanProcesses) {
        const resumeDb = supabase as unknown as ResumeDbClient;
        for (const runId of result.recovered) {
          try {
            const ok = await resumeRun(runId, resumeDb, recoveryLogger);
            if (ok) {
              logger.info({ runId }, "startup recovery: auto-re-queued paused run");
            }
          } catch (resumeErr) {
            logger.warn(
              { runId, err: resumeErr },
              "startup recovery: failed to auto-re-queue run; leaving paused",
            );
          }
        }
      }
    } else {
      logger.info("startup recovery: no orphaned runs");
    }
    if (result.errored.length > 0) {
      logger.warn(
        { count: result.errored.length, runIds: result.errored },
        "startup recovery: some runs could not be recovered",
      );
    }
    return result;
  } catch (err) {
    logger.error({ err }, "startup recovery threw unexpectedly");
    return { recovered: [], errored: [] };
  }
}

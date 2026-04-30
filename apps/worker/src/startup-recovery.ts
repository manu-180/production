/**
 * Conductor — Worker Startup Recovery
 *
 * On boot, sweep the `runs` table for orphans (status='running' with stale
 * heartbeat) and flip them to `paused` with cancellation_reason
 * 'worker_crash_recovery'. See `@conductor/core/recovery/crash-recovery` for
 * the underlying logic.
 *
 * Always best-effort: a failure here logs and exits so worker boot can
 * continue.
 */

import {
  type RecoveryDbClient,
  recoverOrphanedRuns,
} from "@conductor/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";

export interface StartupRecoveryOptions {
  staleMs?: number;
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
    const result = await recoverOrphanedRuns(db, {
      staleMs: opts.staleMs ?? 60_000,
      logger: recoveryLogger,
    });
    if (result.recovered.length > 0) {
      logger.info(
        { count: result.recovered.length, runIds: result.recovered },
        "startup recovery: orphaned runs paused",
      );
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

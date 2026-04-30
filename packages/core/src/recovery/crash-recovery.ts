/**
 * Conductor — Crash Recovery (Recovery)
 *
 * On worker startup (or periodically) we sweep the `runs` table looking for
 * rows that are still marked `running` but whose `last_heartbeat_at` is stale
 * (default: > 60s old) or NULL. These are orphans left behind by a worker
 * crash, OS kill, power loss, etc.
 *
 * Each orphan is flipped to `paused` with `cancellation_reason =
 * 'worker_crash_recovery'`. The run is *not* automatically re-queued — that's
 * a manual user decision (see `resumability.resumeRun`).
 *
 * Errors on individual rows are logged (best-effort) and the sweep keeps going
 * so a single bad row can't block recovery for the rest.
 */

export interface CrashRecoveryLogger {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
}

/**
 * Subset of the Supabase JS client used by {@link recoverOrphanedRuns}. Kept
 * structural so any DB client matching the shape is acceptable.
 */
export interface RecoveryDbClient {
  from(table: string): RecoveryDbTable;
}

export interface RecoveryDbTable {
  select(cols?: string): RecoveryDbSelect;
  update(data: Record<string, unknown>): RecoveryDbUpdate;
}

export interface RecoveryDbSelect extends PromiseLike<RecoveryDbResult<RecoveryRunRow[]>> {
  eq(col: string, val: unknown): RecoveryDbSelect;
  lt(col: string, val: unknown): RecoveryDbSelect;
  or(filter: string): RecoveryDbSelect;
}

export interface RecoveryDbUpdate extends PromiseLike<RecoveryDbResult<unknown>> {
  eq(col: string, val: unknown): RecoveryDbUpdate;
}

export interface RecoveryDbResult<T> {
  data: T | null;
  error: unknown;
}

export interface RecoveryRunRow {
  id: string;
  status?: string;
  last_heartbeat_at?: string | null;
}

export interface RecoverOrphanedOptions {
  /** Heartbeat staleness threshold in ms. Default 60_000. */
  staleMs?: number;
  logger?: CrashRecoveryLogger;
  /** Time source. Defaults to `Date.now`. */
  now?: () => number;
}

export interface RecoverOrphanedResult {
  /** Ids of runs that were transitioned to `paused`. */
  recovered: string[];
  /** Ids that we attempted to update but the DB returned an error for. */
  errored: string[];
}

const DEFAULT_STALE_MS = 60_000;

/**
 * Find every `runs` row in `running` state whose `last_heartbeat_at` is older
 * than the cutoff (or NULL) and flip it to `paused` with cancellation_reason
 * = 'worker_crash_recovery'. Best-effort throughout: never throws.
 */
export async function recoverOrphanedRuns(
  db: RecoveryDbClient,
  opts: RecoverOrphanedOptions = {},
): Promise<RecoverOrphanedResult> {
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const logger = opts.logger;
  const now = opts.now ?? Date.now;
  const cutoffIso = new Date(now() - staleMs).toISOString();

  const recovered: string[] = [];
  const errored: string[] = [];

  let rows: RecoveryRunRow[] = [];
  try {
    const result = await db
      .from("runs")
      .select("id, status, last_heartbeat_at")
      .eq("status", "running")
      .or(`last_heartbeat_at.is.null,last_heartbeat_at.lt.${cutoffIso}`);

    if (result.error !== null && result.error !== undefined) {
      logger?.error?.({ err: result.error }, "[CrashRecovery] query for orphans failed");
      return { recovered, errored };
    }
    rows = result.data ?? [];
  } catch (err) {
    logger?.error?.({ err }, "[CrashRecovery] query for orphans threw");
    return { recovered, errored };
  }

  if (rows.length === 0) {
    logger?.info?.({}, "[CrashRecovery] no orphaned runs found");
    return { recovered, errored };
  }

  for (const row of rows) {
    if (typeof row.id !== "string" || row.id.length === 0) continue;
    try {
      const update = await db
        .from("runs")
        .update({
          status: "paused",
          cancellation_reason: "worker_crash_recovery",
          finished_at: null,
        })
        .eq("id", row.id)
        // CAS guard: only flip if it's still 'running'. Avoids stomping a
        // status that another worker just transitioned.
        .eq("status", "running");

      if (update.error !== null && update.error !== undefined) {
        logger?.warn?.(
          { runId: row.id, err: update.error },
          "[CrashRecovery] failed to mark run as paused",
        );
        errored.push(row.id);
        continue;
      }
      logger?.info?.(
        { runId: row.id, lastHeartbeatAt: row.last_heartbeat_at ?? null },
        "[CrashRecovery] recovered orphaned run",
      );
      recovered.push(row.id);
    } catch (err) {
      logger?.warn?.({ runId: row.id, err }, "[CrashRecovery] update threw");
      errored.push(row.id);
    }
  }

  return { recovered, errored };
}

/**
 * Conductor — Health Monitor (Recovery)
 *
 * Periodically writes `runs.last_heartbeat_at = now()` for an active run so
 * external observers (and the orphan-recovery sweeper) can tell that the
 * worker holding the run is still alive.
 *
 * Errors are *never* thrown from the tick — telemetry must never break the
 * run. They're logged via the optional `logger` and the loop keeps going.
 */

import type { DbClient } from "../orchestrator/orchestrator.js";

export interface HealthMonitorLogger {
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
}

export interface HealthMonitorOptions {
  /** Heartbeat interval in milliseconds. Default 10_000. */
  intervalMs?: number;
  logger?: HealthMonitorLogger;
  /** Time source (test injection). Defaults to `() => new Date().toISOString()`. */
  nowIso?: () => string;
}

const DEFAULT_INTERVAL_MS = 10_000;

/**
 * Per-run heartbeat publisher. Single-run lifecycle:
 *  ```ts
 *  const hm = new HealthMonitor(db);
 *  hm.start(runId);     // begins ticking on the configured interval
 *  // ...do work...
 *  await hm.stop();     // cancels the timer + emits one final heartbeat
 *  ```
 *
 * Re-entrant safe: calling `start()` while already running is a no-op (the
 * existing timer keeps firing). `stop()` is idempotent.
 */
export class HealthMonitor {
  private readonly db: DbClient;
  private readonly intervalMs: number;
  private readonly logger: HealthMonitorLogger | undefined;
  private readonly nowIso: () => string;

  private timer: ReturnType<typeof setInterval> | null = null;
  private currentRunId: string | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(db: DbClient, opts: HealthMonitorOptions = {}) {
    this.db = db;
    this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.logger = opts.logger;
    this.nowIso = opts.nowIso ?? ((): string => new Date().toISOString());
  }

  /**
   * Start ticking for `runId`. Emits an immediate heartbeat then schedules
   * recurring ticks every `intervalMs`. Calling while already started is a
   * no-op (you must `stop()` first to switch runs).
   */
  start(runId: string): void {
    if (this.timer !== null) return;
    this.currentRunId = runId;
    // Immediate heartbeat so a freshly-started run never appears stale.
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  /**
   * Stop ticking and await any in-flight DB write so the caller knows the
   * monitor is fully quiet. Idempotent.
   */
  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.currentRunId = null;
    if (this.inFlight !== null) {
      try {
        await this.inFlight;
      } catch {
        // already logged inside tick()
      }
    }
  }

  /** True while a heartbeat loop is active. */
  isRunning(): boolean {
    return this.timer !== null;
  }

  /** Force a single heartbeat (mostly for tests). */
  async heartbeatNow(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    const runId = this.currentRunId;
    if (runId === null) return;
    const promise = this.write(runId);
    this.inFlight = promise;
    try {
      await promise;
    } finally {
      // Only clear if we're still the active in-flight; another tick may have
      // overwritten us in a fast-firing scheduler.
      if (this.inFlight === promise) this.inFlight = null;
    }
  }

  private async write(runId: string): Promise<void> {
    try {
      const { error } = await this.db
        .from("runs")
        .update({ last_heartbeat_at: this.nowIso() })
        .eq("id", runId);
      if (error !== null && error !== undefined) {
        this.logger?.warn?.(
          { runId, err: error },
          "[HealthMonitor] heartbeat update returned error",
        );
      }
    } catch (err) {
      this.logger?.error?.({ runId, err }, "[HealthMonitor] heartbeat threw");
    }
  }
}

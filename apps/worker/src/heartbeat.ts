/**
 * Conductor — Worker Heartbeat
 *
 * Thin wrapper around `@conductor/core`'s {@link HealthMonitor}. Exposed as a
 * standalone module so the worker's RunHandler can lifecycle-manage it
 * independently from the orchestrator (heartbeat starts as soon as we claim
 * the run and stops when the run terminates, even if the orchestrator was
 * never instantiated due to a load-time failure).
 */

import { HealthMonitor, type HealthMonitorOptions } from "@conductor/core";
import type { DbClient } from "@conductor/core";
import type { Logger } from "pino";

export interface WorkerHeartbeatOptions {
  intervalMs?: number;
  logger?: Logger;
}

/**
 * Build a {@link HealthMonitor} configured with the worker's pino logger and
 * a sensible default interval (10s). The returned monitor must be started
 * with `start(runId)` and stopped with `await stop()`.
 */
export function createHeartbeat(
  db: DbClient,
  opts: WorkerHeartbeatOptions = {},
): HealthMonitor {
  const monitorOpts: HealthMonitorOptions = {
    intervalMs: opts.intervalMs ?? 10_000,
  };
  if (opts.logger) {
    const baseLogger = opts.logger;
    monitorOpts.logger = {
      warn: (obj: unknown, msg?: string) => {
        if (msg !== undefined) {
          baseLogger.warn(obj, msg);
        } else {
          baseLogger.warn(obj);
        }
      },
      error: (obj: unknown, msg?: string) => {
        if (msg !== undefined) {
          baseLogger.error(obj, msg);
        } else {
          baseLogger.error(obj);
        }
      },
    };
  }
  return new HealthMonitor(db, monitorOpts);
}

/**
 * Conductor — Worker entrypoint
 *
 * Long-running process that watches the `runs` table for queued work, claims
 * runs with an optimistic compare-and-swap update, and hands each one off to
 * a {@link RunHandler}. Concurrency is bounded by `WORKER_CONCURRENCY`
 * (default 1).
 *
 * Discovery is handled by {@link PgListener} — today a fixed-interval poller,
 * tomorrow a real `LISTEN`/`NOTIFY` hookup. The handler interface stays the
 * same so swapping is transparent to this file.
 *
 * Shutdown is cooperative: on SIGTERM/SIGINT we stop the listener and signal
 * every active handler to cancel before exiting. Handlers in turn drive the
 * orchestrator's cancel path, which kills the in-flight Claude process.
 */

import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
const __workerDir = dirname(fileURLToPath(import.meta.url));
// Load from monorepo root (../../.env relative to src/)
loadEnv({ path: resolve(__workerDir, "../../../.env") });
import type { Database } from "@conductor/db";
import { createClient } from "@supabase/supabase-js";
import pino from "pino";
import { PgListener } from "./lib/pg-listen.js";
import { RunHandler } from "./run-handler.js";
import { startSchedulerTick } from "./scheduler-tick.js";
import { runStartupRecovery } from "./startup-recovery.js";

// ─────────────────────────────────────────────────────────────────────────────
// Logger
// ─────────────────────────────────────────────────────────────────────────────

const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  transport: process.env["NODE_ENV"] !== "production" ? { target: "pino-pretty" } : undefined,
});

// ─────────────────────────────────────────────────────────────────────────────
// Env
// ─────────────────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const WORKER_CONCURRENCY = Number.parseInt(process.env["WORKER_CONCURRENCY"] ?? "1", 10);

if (!Number.isFinite(WORKER_CONCURRENCY) || WORKER_CONCURRENCY < 1) {
  throw new Error(
    `Invalid WORKER_CONCURRENCY=${process.env["WORKER_CONCURRENCY"] ?? ""} — must be a positive integer`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const activeRuns = new Map<string, RunHandler>();
const activePromises = new Map<string, Promise<void>>();
let shuttingDown = false;

// ─────────────────────────────────────────────────────────────────────────────
// Run discovery + claim
// ─────────────────────────────────────────────────────────────────────────────

interface QueuedRunRow {
  id: string;
  plan_id: string;
  working_dir: string;
}

/**
 * Look for one queued run, atomically claim it, and start a handler.
 *
 * Claiming is done as a `WHERE status='queued'` conditional UPDATE — if two
 * workers race on the same row, only one update will affect a row and the
 * loser silently moves on. This is good enough for the polling backend; a
 * proper `SELECT FOR UPDATE SKIP LOCKED` lands when we cut over to a Postgres
 * connection.
 */
async function checkForQueuedRuns(): Promise<void> {
  if (shuttingDown) return;
  if (activeRuns.size >= WORKER_CONCURRENCY) return;

  const db = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: runs, error: selectError } = await db
    .from("runs")
    .select("id, plan_id, working_dir")
    .eq("status", "queued")
    .limit(1);

  if (selectError !== null) {
    logger.error({ err: selectError }, "failed to query queued runs");
    return;
  }

  const rows = (runs ?? []) as QueuedRunRow[];
  const run = rows[0];
  if (run === undefined) return;

  // Atomic claim. The second `.eq('status', 'queued')` is the CAS guard:
  // if another worker already flipped it, our update affects zero rows and
  // we let it proceed.
  const { error: claimError } = await db
    .from("runs")
    .update({ status: "running" })
    .eq("id", run.id)
    .eq("status", "queued");

  if (claimError !== null) {
    logger.error({ runId: run.id, err: claimError }, "failed to claim run");
    return;
  }

  const handler = new RunHandler({
    runId: run.id,
    supabaseUrl: SUPABASE_URL,
    supabaseServiceKey: SUPABASE_SERVICE_ROLE_KEY,
    logger,
  });
  activeRuns.set(run.id, handler);

  const promise = handler
    .execute()
    .then(() => {
      activeRuns.delete(run.id);
      activePromises.delete(run.id);
      logger.info({ runId: run.id }, "run completed");
    })
    .catch((err: unknown) => {
      activeRuns.delete(run.id);
      activePromises.delete(run.id);
      logger.error({ runId: run.id, err }, "run handler threw unexpectedly");
    });
  activePromises.set(run.id, promise);
}

// ─────────────────────────────────────────────────────────────────────────────
// Listener
// ─────────────────────────────────────────────────────────────────────────────

const listener = new PgListener({
  supabaseUrl: SUPABASE_URL,
  supabaseServiceKey: SUPABASE_SERVICE_ROLE_KEY,
  channel: "conductor_runs_queued",
  onNotify: checkForQueuedRuns,
  pollIntervalMs: 3_000,
});

// ─────────────────────────────────────────────────────────────────────────────
// Worker instance heartbeat (keeps worker_instances.last_seen_at fresh)
// ─────────────────────────────────────────────────────────────────────────────

const WORKER_ID = `${hostname()}-${process.pid}`;
const WORKER_HEARTBEAT_INTERVAL_MS = 15_000;

async function upsertWorkerHeartbeat(db: ReturnType<typeof createClient<Database>>): Promise<void> {
  await db.from("worker_instances").upsert(
    {
      id: WORKER_ID,
      hostname: hostname(),
      pid: process.pid,
      started_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
}

async function updateWorkerHeartbeat(db: ReturnType<typeof createClient<Database>>): Promise<void> {
  await db
    .from("worker_instances")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", WORKER_ID);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler tick (populated at boot, referenced during shutdown)
// ─────────────────────────────────────────────────────────────────────────────

let stopSchedulerTick: (() => void) | null = null;
let workerHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Graceful shutdown
// ─────────────────────────────────────────────────────────────────────────────

const SHUTDOWN_TIMEOUT_MS = 10_000;

function gracefulShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down gracefully");

  const shutdown = async (): Promise<void> => {
    listener.stop();
    stopSchedulerTick?.();
    if (workerHeartbeatTimer !== null) {
      clearInterval(workerHeartbeatTimer);
      workerHeartbeatTimer = null;
    }

    for (const [runId, handler] of activeRuns) {
      handler.cancel(`worker shutdown: ${signal}`);
      logger.info({ runId }, "cancelled active run");
    }

    // Wait for all in-flight runs to settle, capped by SHUTDOWN_TIMEOUT_MS so
    // a misbehaving handler can't block process exit indefinitely.
    await Promise.race([
      Promise.allSettled([...activePromises.values()]),
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
    ]);
    logger.info("all runs finished or timed out, exiting");
    process.exit(0);
  };

  void shutdown();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

logger.info(
  { concurrency: WORKER_CONCURRENCY, pollIntervalMs: 3_000 },
  "conductor worker starting",
);

// Sweep orphaned runs from prior worker crashes BEFORE we start listening.
// Failures here are logged and do not block startup.
{
  const recoveryClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  await runStartupRecovery(recoveryClient, logger);
}

await listener.start();

// Register this worker instance and start the heartbeat loop.
{
  const heartbeatClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  await upsertWorkerHeartbeat(heartbeatClient);
  workerHeartbeatTimer = setInterval(() => {
    void updateWorkerHeartbeat(heartbeatClient).catch((err: unknown) => {
      logger.warn({ err }, "worker heartbeat tick failed");
    });
  }, WORKER_HEARTBEAT_INTERVAL_MS);
}

// Start the scheduler tick. A dedicated client is used so the scheduler's
// Supabase calls are isolated from the run-polling client.
{
  const schedulerClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  stopSchedulerTick = startSchedulerTick(schedulerClient, logger);
}

logger.info({ workerId: WORKER_ID }, "conductor worker ready");

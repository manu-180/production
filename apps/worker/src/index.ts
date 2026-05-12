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

import { existsSync, statSync } from "node:fs";
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
import { startOrphanSweeperTick } from "./orphan-sweeper-tick.js";
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

// Hoisted Supabase client used by the queue poller. Previously a fresh
// client was created on every tick (every 3s) which leaked socket handles
// on long-running workers — observed contributing to OOM during multi-hour
// 360-prompt plans on Windows. One client survives the whole worker
// lifetime; Supabase-js manages its own pool.
const queuePollerDb = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// Run discovery + claim
// ─────────────────────────────────────────────────────────────────────────────

interface QueuedRunRow {
  id: string;
  plan_id: string;
  working_dir: string;
}

/**
 * Returns true when this worker can actually execute the given run — i.e.
 * its `working_dir` exists on this host's filesystem and is a directory.
 *
 * In a multi-machine setup (the same Supabase project shared between, say,
 * a desktop and a laptop) every worker subscribes to the same queue but
 * each only has access to a subset of the user's project folders. Without
 * this guard, the wrong worker can win the claim race and then hang in
 * `RepoInitializer` trying to `git status` a path that doesn't exist —
 * leaving the run zombie with `started_at = null`.
 */
function workerCanHandle(workingDir: string): boolean {
  try {
    if (!existsSync(workingDir)) return false;
    return statSync(workingDir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Look for one queued run, atomically claim it, and start a handler.
 *
 * Claiming is done as a `WHERE status='queued'` conditional UPDATE — if two
 * workers race on the same row, only one update will affect a row and the
 * loser silently moves on. This is good enough for the polling backend; a
 * proper `SELECT FOR UPDATE SKIP LOCKED` lands when we cut over to a Postgres
 * connection.
 *
 * Multi-host filtering: we pull a small batch of candidates (oldest first)
 * and pick the first one whose `working_dir` exists on this host. Anything
 * we skip stays `queued` for whichever worker can satisfy the path.
 */
async function checkForQueuedRuns(): Promise<void> {
  if (shuttingDown) return;
  if (activeRuns.size >= WORKER_CONCURRENCY) return;

  const db = queuePollerDb;

  const { data: runs, error: selectError } = await db
    .from("runs")
    .select("id, plan_id, working_dir")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(10);

  if (selectError !== null) {
    logger.error({ err: selectError }, "failed to query queued runs");
    return;
  }

  const rows = (runs ?? []) as QueuedRunRow[];
  if (rows.length === 0) return;

  const run = rows.find((r) => workerCanHandle(r.working_dir));
  if (run === undefined) {
    // Raised from debug → warn so the operator notices when queued runs are
    // being silently skipped because the working dir doesn't exist on this
    // host (e.g. network drive disconnected, antivirus quarantined the
    // folder, plan was created on a different machine). Previously these
    // runs sat in `queued` forever with no visible signal.
    logger.warn(
      {
        host: hostname(),
        skipped: rows.length,
        firstSkippedDir: rows[0]?.working_dir ?? null,
      },
      "queued runs exist but none match this host's filesystem — leaving them for another worker",
    );
    return;
  }

  // Pre-register the run in `activeRuns` BEFORE flipping the DB status.
  // The orphan-sweeper reads `activeRuns` via `getActiveRunIds()` and uses
  // that set to exclude in-flight runs from reaping. If we flip
  // `status='running'` first and only set `activeRuns.set(...)` after the
  // RunHandler is constructed, the sweeper has a small window where it
  // sees status='running' + last_heartbeat_at=NULL + run NOT in
  // activeRuns → false-positive orphan → run gets re-paused before its
  // first heartbeat lands. Reserving the slot with a placeholder closes
  // that window.
  const placeholderHandler = { runId: run.id } as unknown as RunHandler;
  activeRuns.set(run.id, placeholderHandler);

  // Atomic claim. The second `.eq('status', 'queued')` is the CAS guard:
  // if another worker already flipped it, our update affects zero rows and
  // we let it proceed.
  const { error: claimError } = await db
    .from("runs")
    .update({ status: "running" })
    .eq("id", run.id)
    .eq("status", "queued");

  if (claimError !== null) {
    activeRuns.delete(run.id);
    logger.error({ runId: run.id, err: claimError }, "failed to claim run");
    return;
  }

  const handler = new RunHandler({
    runId: run.id,
    supabaseUrl: SUPABASE_URL,
    supabaseServiceKey: SUPABASE_SERVICE_ROLE_KEY,
    logger,
  });
  // Replace the placeholder slot reserved above with the real handler.
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
let stopOrphanSweeperTick: (() => void) | null = null;
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
    stopOrphanSweeperTick?.();
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

// Start the periodic orphan-run sweeper. Recovers runs left in `running`
// by a crashed worker (DB rows only; claude.exe processes are cleaned up
// on the next worker boot). Excludes the runs this worker currently owns
// so we never reap our own in-flight work.
{
  const sweeperClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  stopOrphanSweeperTick = startOrphanSweeperTick(sweeperClient, logger, {
    getActiveRunIds: () => new Set(activeRuns.keys()),
  });
}

logger.info({ workerId: WORKER_ID }, "conductor worker ready");

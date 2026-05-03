import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defineRoute, respond } from "@/lib/api";
import { createServiceClient } from "@conductor/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const WORKER_HEARTBEAT_FRESH_MS = 30_000;
const CLAUDE_VERSION_TIMEOUT_MS = 3_000;

interface HealthResponse {
  web: "ok";
  db: "ok" | "down";
  worker: "ok" | "offline" | "unknown";
  claudeCli: { installed: boolean; version?: string };
}

/**
 * GET /api/system/health — public liveness probe.
 *
 * Always returns 200 even when components are down; the body carries the
 * per-component status so dashboards can render a degraded state instead of
 * being blind. The only public endpoint in the API surface (auth: false).
 *
 * - `db` — runs a 1-row read; transparent failure marks `down`.
 * - `worker` — checks `worker_instances.last_seen_at` against a 30s window.
 * - `claudeCli` — invokes `claude --version` with a 3s timeout.
 *
 * All checks run in parallel with `Promise.allSettled` so a slow probe
 * doesn't block the others.
 */
export const GET = defineRoute<undefined, undefined>(
  { auth: false, rateLimit: "none" },
  async ({ traceId }) => {
    const [dbResult, workerResult, claudeResult] = await Promise.allSettled([
      checkDb(),
      checkWorker(),
      checkClaudeCli(),
    ]);

    const body: HealthResponse = {
      web: "ok",
      db: dbResult.status === "fulfilled" ? dbResult.value : "down",
      worker: workerResult.status === "fulfilled" ? workerResult.value : "unknown",
      claudeCli: claudeResult.status === "fulfilled" ? claudeResult.value : { installed: false },
    };

    return respond(body, { traceId });
  },
);

async function checkDb(): Promise<"ok" | "down"> {
  try {
    const db = createServiceClient();
    const { error } = await db.from("plans").select("id").limit(1);
    return error === null ? "ok" : "down";
  } catch {
    return "down";
  }
}

async function checkWorker(): Promise<"ok" | "offline" | "unknown"> {
  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from("worker_instances")
      .select("last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error !== null) return "unknown";
    if (data === null) return "offline";
    const lastSeen = new Date(data.last_seen_at).getTime();
    if (Number.isNaN(lastSeen)) return "unknown";
    return Date.now() - lastSeen <= WORKER_HEARTBEAT_FRESH_MS ? "ok" : "offline";
  } catch {
    return "unknown";
  }
}

async function checkClaudeCli(): Promise<{ installed: boolean; version?: string }> {
  try {
    const { stdout } = await execFileAsync("claude", ["--version"], {
      timeout: CLAUDE_VERSION_TIMEOUT_MS,
      shell: process.platform === "win32",
    });
    const match = /(\d+\.\d+\.\d+)/.exec(stdout);
    return { installed: true, version: match?.[1] };
  } catch {
    return { installed: false };
  }
}

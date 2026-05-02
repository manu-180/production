#!/usr/bin/env tsx
/**
 * loadtest.ts — Load test for the Conductor API.
 *
 * Launches 10 plans with 5 prompts each, triggers runs for all of them,
 * and tracks completion latency. Prints a throughput summary including
 * P50 and P95 latency.
 *
 * Usage:
 *   AUTH_TOKEN=<token> pnpm loadtest
 *   AUTH_TOKEN=<token> pnpm loadtest --base-url http://localhost:3000
 *   AUTH_TOKEN=<token> pnpm tsx scripts/loadtest.ts --base-url https://your-host
 *
 * Environment variables:
 *   AUTH_TOKEN  (required) Bearer token for API auth.
 *
 * Flags:
 *   --base-url <url>  Base URL of the Conductor API (default: http://localhost:3000)
 *   --plans    <n>    Number of plans to create (default: 10)
 *   --prompts  <n>    Prompts per plan (default: 5)
 *   --timeout  <ms>   Max ms to wait per run (default: 120000)
 *   --help            Show this message
 */

import * as path from "node:path";
import * as dotenv from "dotenv";

// ─── env bootstrap ───────────────────────────────────────────────────────────

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

// ─── argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  baseUrl: string;
  planCount: number;
  promptsPerPlan: number;
  timeoutMs: number;
} {
  let baseUrl = "http://localhost:3000";
  let planCount = 10;
  let promptsPerPlan = 5;
  let timeoutMs = 120_000;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--base-url":
        baseUrl = argv[++i] ?? baseUrl;
        break;
      case "--plans":
        planCount = Number.parseInt(argv[++i] ?? "10", 10);
        break;
      case "--prompts":
        promptsPerPlan = Number.parseInt(argv[++i] ?? "5", 10);
        break;
      case "--timeout":
        timeoutMs = Number.parseInt(argv[++i] ?? "120000", 10);
        break;
      case "--help":
      case "-h":
        process.stdout.write(
          [
            "Usage: AUTH_TOKEN=<token> pnpm tsx scripts/loadtest.ts [options]",
            "",
            "Options:",
            "  --base-url <url>  API base URL (default: http://localhost:3000)",
            "  --plans <n>       Number of plans (default: 10)",
            "  --prompts <n>     Prompts per plan (default: 5)",
            "  --timeout <ms>    Per-run timeout in ms (default: 120000)",
            "  --help            Show this message",
            "",
          ].join("\n"),
        );
        process.exit(0);
    }
  }

  return { baseUrl, planCount, promptsPerPlan, timeoutMs };
}

const args = parseArgs(process.argv.slice(2));
const { baseUrl, planCount, promptsPerPlan, timeoutMs } = args;

// ─── auth ─────────────────────────────────────────────────────────────────────

const AUTH_TOKEN = process.env["AUTH_TOKEN"];
if (!AUTH_TOKEN) {
  console.error("ERROR: AUTH_TOKEN environment variable is required.");
  console.error("  export AUTH_TOKEN=<your-token> && pnpm loadtest");
  process.exit(1);
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// Use process.stdout.write to avoid noConsoleLog lint rule on intentional output.
const log = (msg: string) => process.stdout.write(`[loadtest] ${msg}\n`);

function buildHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${AUTH_TOKEN}`,
  };
}

async function apiPost<T = unknown>(urlPath: string, body: unknown): Promise<T> {
  const url = `${baseUrl}${urlPath}`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`POST ${urlPath} -> HTTP ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

async function apiGet<T = unknown>(urlPath: string): Promise<T> {
  const url = `${baseUrl}${urlPath}`;
  const res = await fetch(url, {
    method: "GET",
    headers: buildHeaders(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`GET ${urlPath} -> HTTP ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

async function apiDelete(urlPath: string): Promise<void> {
  const url = `${baseUrl}${urlPath}`;
  await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(),
  });
}

// ─── statistics ───────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  const clamped = Math.max(0, Math.min(idx, sorted.length - 1));
  return sorted[clamped] ?? 0;
}

// ─── plan / run lifecycle ─────────────────────────────────────────────────────

interface PlanResponse {
  id: string;
}

interface RunResponse {
  id: string;
  status?: string;
}

async function createTestPlan(index: number): Promise<string> {
  const prompts = Array.from({ length: promptsPerPlan }, (_, i) => ({
    content: `echo "load-test plan ${index} prompt ${i}"`,
    title: `Prompt ${i + 1}`,
    order_index: i,
  }));

  const data = await apiPost<PlanResponse>("/api/plans", {
    name: `__loadtest-${Date.now()}-${index}__`,
    description: "Automated load test plan — safe to delete",
    tags: ["loadtest"],
    prompts,
  });

  return data.id;
}

async function triggerRun(planId: string): Promise<string> {
  const data = await apiPost<RunResponse>(`/api/plans/${planId}/runs`, {
    workingDir: "/tmp/conductor-loadtest",
  });

  return data.id;
}

async function waitForRun(
  runId: string,
  deadlineMs: number,
): Promise<{ status: string; latencyMs: number }> {
  const start = Date.now();
  const deadline = start + deadlineMs;

  while (Date.now() < deadline) {
    const data = await apiGet<RunResponse>(`/api/runs/${runId}`);
    const status = data.status ?? "unknown";

    if (["completed", "failed", "cancelled"].includes(status)) {
      return { status, latencyMs: Date.now() - start };
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
  }

  return { status: "timeout", latencyMs: Date.now() - start };
}

// ─── main ─────────────────────────────────────────────────────────────────────

interface RunResult {
  planId: string;
  runId: string;
  status: string;
  latencyMs: number;
  error?: string;
}

async function main(): Promise<void> {
  log("=== Conductor Load Test ===");
  log(`  Base URL       : ${baseUrl}`);
  log(`  Plans          : ${planCount}`);
  log(`  Prompts / plan : ${promptsPerPlan}`);
  log(`  Run timeout    : ${timeoutMs}ms`);
  log("");

  const overallStart = Date.now();

  // Phase 1: Create all plans concurrently.
  log(`Phase 1: Creating ${planCount} plans...`);
  const planIds: string[] = await Promise.all(
    Array.from({ length: planCount }, (_, i) =>
      createTestPlan(i).catch((err: unknown) => {
        log(`  ERROR creating plan ${i}: ${String(err)}`);
        return "";
      }),
    ),
  );
  const validPlans = planIds.filter(Boolean);
  log(`  Created ${validPlans.length}/${planCount} plans`);

  // Phase 2: Trigger all runs concurrently.
  log(`Phase 2: Triggering ${validPlans.length} runs...`);
  const runEntries: Array<{ planId: string; runId: string }> = [];

  await Promise.all(
    validPlans.map(async (planId) => {
      try {
        const runId = await triggerRun(planId);
        runEntries.push({ planId, runId });
      } catch (err) {
        log(`  ERROR triggering run for plan ${planId}: ${String(err)}`);
      }
    }),
  );
  log(`  Triggered ${runEntries.length} runs`);

  // Phase 3: Wait for all runs to settle.
  log(`Phase 3: Waiting for runs to complete (timeout: ${timeoutMs}ms)...`);
  const results: RunResult[] = await Promise.all(
    runEntries.map(async ({ planId, runId }) => {
      try {
        const { status, latencyMs } = await waitForRun(runId, timeoutMs);
        return { planId, runId, status, latencyMs };
      } catch (err) {
        return {
          planId,
          runId,
          status: "error",
          latencyMs: timeoutMs,
          error: String(err),
        };
      }
    }),
  );

  // Phase 4: Cleanup — delete all test plans.
  log("Phase 4: Cleaning up test plans...");
  await Promise.all(
    validPlans.map((planId) =>
      apiDelete(`/api/plans/${planId}`).catch(() => {
        /* best effort */
      }),
    ),
  );
  log("  Cleanup complete");

  // ─── statistics ─────────────────────────────────────────────────────────────

  const totalMs = Date.now() - overallStart;

  const completed = results.filter((r) => r.status === "completed");
  const failed = results.filter((r) => r.status === "failed");
  const cancelled = results.filter((r) => r.status === "cancelled");
  const timedOut = results.filter((r) => r.status === "timeout");
  const errors = results.filter((r) => r.status === "error");

  const latencies = completed.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const avgLatency =
    latencies.length > 0 ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : 0;

  const throughput = totalMs > 0 ? ((completed.length / totalMs) * 1000).toFixed(2) : "0.00";

  // Print summary to stdout.
  process.stdout.write("\n=== Load Test Results ===\n");
  process.stdout.write(`  Total wall time     : ${totalMs}ms\n`);
  process.stdout.write(`  Runs triggered      : ${runEntries.length}\n`);
  process.stdout.write(`  Completed           : ${completed.length}\n`);
  process.stdout.write(`  Failed              : ${failed.length}\n`);
  process.stdout.write(`  Cancelled           : ${cancelled.length}\n`);
  process.stdout.write(`  Timed out           : ${timedOut.length}\n`);
  process.stdout.write(`  Errors              : ${errors.length}\n`);
  process.stdout.write("\n");
  process.stdout.write(`  Throughput          : ${throughput} runs/s\n`);
  process.stdout.write("  Latency (completed) :\n");
  process.stdout.write(`    avg               : ${avgLatency}ms\n`);
  process.stdout.write(`    P50               : ${p50}ms\n`);
  process.stdout.write(`    P95               : ${p95}ms\n`);
  process.stdout.write(`    min               : ${latencies[0] ?? 0}ms\n`);
  process.stdout.write(`    max               : ${latencies[latencies.length - 1] ?? 0}ms\n`);
  process.stdout.write("\n");

  if (errors.length > 0) {
    process.stdout.write("  Errors detail:\n");
    for (const r of errors) {
      process.stdout.write(`    run ${r.runId}: ${r.error ?? "unknown"}\n`);
    }
    process.stdout.write("\n");
  }

  const success = errors.length === 0 && timedOut.length === 0;
  if (!success) {
    console.error(
      `[loadtest] WARN: ${errors.length} errors, ${timedOut.length} timeouts. Review results above.`,
    );
    process.exit(1);
  }

  log("=== Load test complete ===");
}

main().catch((err: unknown) => {
  console.error("[loadtest] FATAL:", err);
  process.exit(1);
});

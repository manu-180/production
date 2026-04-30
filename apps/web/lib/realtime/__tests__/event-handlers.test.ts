import type { Plan, PromptExecution, Run } from "@conductor/db";
import { describe, expect, it } from "vitest";
import {
  applyEvent,
  type RealtimeEvent,
  type RunDetailCache,
  seedCache,
} from "../event-handlers";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    plan_id: "plan-1",
    user_id: "user-1",
    status: "queued",
    started_at: null,
    finished_at: null,
    current_prompt_index: 0,
    checkpoint_branch: null,
    cancellation_reason: null,
    last_heartbeat_at: null,
    triggered_by: "manual",
    working_dir: "/tmp",
    total_cost_usd: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cache_tokens: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Run;
}

function makeExec(overrides: Partial<PromptExecution> = {}): PromptExecution {
  return {
    id: "exec-1",
    run_id: "run-1",
    prompt_id: "p-1",
    status: "pending",
    attempt: 0,
    started_at: null,
    finished_at: null,
    duration_ms: null,
    claude_session_id: null,
    checkpoint_sha: null,
    cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_tokens: 0,
    error_code: null,
    error_message: null,
    error_raw: null,
    created_at: new Date().toISOString(),
    ...overrides,
  } as PromptExecution;
}

function makeCache(overrides: Partial<RunDetailCache> = {}): RunDetailCache {
  return seedCache({
    ...makeRun(),
    executions: [makeExec()],
    plan: null as Plan | null,
    ...overrides,
  } as Omit<RunDetailCache, "_lastAppliedSequence">);
}

function ev(partial: Partial<RealtimeEvent>): RealtimeEvent {
  return {
    runId: "run-1",
    sequence: 1,
    eventType: "run.started",
    payload: {},
    promptExecutionId: null,
    ...partial,
  };
}

describe("applyEvent — run lifecycle", () => {
  it("run.started sets status=running", () => {
    const cache = makeCache();
    const next = applyEvent(
      cache,
      ev({ eventType: "run.started", payload: { startedAt: "2026-04-30T00:00:00Z" } }),
    );
    expect(next.status).toBe("running");
    expect(next.started_at).toBe("2026-04-30T00:00:00Z");
    expect(next._lastAppliedSequence).toBe(1);
  });

  it("run.paused sets status=paused", () => {
    const cache = makeCache({ ...makeRun({ status: "running" }) });
    const next = applyEvent(cache, ev({ eventType: "run.paused" }));
    expect(next.status).toBe("paused");
  });

  it("run.completed sets status, finished_at, total_cost", () => {
    const cache = makeCache({ ...makeRun({ status: "running" }) });
    const next = applyEvent(
      cache,
      ev({
        eventType: "run.completed",
        payload: { finishedAt: "2026-04-30T01:00:00Z", totalCostUsd: 0.42 },
      }),
    );
    expect(next.status).toBe("completed");
    expect(next.finished_at).toBe("2026-04-30T01:00:00Z");
    expect(next.total_cost_usd).toBe(0.42);
  });

  it("run.failed sets status=failed", () => {
    const cache = makeCache({ ...makeRun({ status: "running" }) });
    const next = applyEvent(cache, ev({ eventType: "run.failed" }));
    expect(next.status).toBe("failed");
  });
});

describe("applyEvent — prompt execution patches", () => {
  it("prompt.started flips matching execution to running", () => {
    const cache = makeCache();
    const next = applyEvent(
      cache,
      ev({ eventType: "prompt.started", promptExecutionId: "exec-1" }),
    );
    const exec = next.executions[0];
    expect(exec).toBeDefined();
    expect(exec?.status).toBe("running");
  });

  it("prompt.completed updates cost and tokens", () => {
    const cache = makeCache();
    const next = applyEvent(
      cache,
      ev({
        eventType: "prompt.completed",
        promptExecutionId: "exec-1",
        payload: {
          costUsd: 0.05,
          inputTokens: 100,
          outputTokens: 50,
          cacheTokens: 10,
          durationMs: 12345,
          finishedAt: "2026-04-30T00:30:00Z",
        },
      }),
    );
    const exec = next.executions[0];
    expect(exec).toBeDefined();
    expect(exec?.status).toBe("succeeded");
    expect(exec?.cost_usd).toBe(0.05);
    expect(exec?.input_tokens).toBe(100);
    expect(exec?.output_tokens).toBe(50);
    expect(exec?.cache_tokens).toBe(10);
    expect(exec?.duration_ms).toBe(12345);
  });

  it("prompt.failed sets status and error fields", () => {
    const cache = makeCache();
    const next = applyEvent(
      cache,
      ev({
        eventType: "prompt.failed",
        promptExecutionId: "exec-1",
        payload: { errorCode: "boom", errorMessage: "kaboom", errorRaw: "stack..." },
      }),
    );
    const exec = next.executions[0];
    expect(exec).toBeDefined();
    expect(exec?.status).toBe("failed");
    expect(exec?.error_code).toBe("boom");
    expect(exec?.error_message).toBe("kaboom");
  });
});

describe("applyEvent — sequence guard + forward compat", () => {
  it("ignores events with sequence <= _lastAppliedSequence (ref-equal)", () => {
    const cache = applyEvent(makeCache(), ev({ sequence: 5, eventType: "run.started" }));
    const stale = applyEvent(cache, ev({ sequence: 5, eventType: "run.paused" }));
    expect(stale).toBe(cache);
    const stillStale = applyEvent(cache, ev({ sequence: 3, eventType: "run.paused" }));
    expect(stillStale).toBe(cache);
  });

  it("unknown event advances sequence with no other patch", () => {
    const cache = makeCache();
    const next = applyEvent(cache, ev({ sequence: 7, eventType: "unknown.event" }));
    expect(next._lastAppliedSequence).toBe(7);
    expect(next.status).toBe(cache.status);
  });

  it("guardian intervention is a no-op patch but advances sequence", () => {
    const cache = makeCache();
    const next = applyEvent(
      cache,
      ev({ sequence: 9, eventType: "prompt.guardian_intervention" }),
    );
    expect(next._lastAppliedSequence).toBe(9);
  });
});

describe("seedCache", () => {
  it("seeds _lastAppliedSequence at -1", () => {
    const cache = makeCache();
    expect(cache._lastAppliedSequence).toBe(-1);
  });
});

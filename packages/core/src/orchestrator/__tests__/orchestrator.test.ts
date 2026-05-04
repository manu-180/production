import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock ClaudeProcess BEFORE importing orchestrator
const claudeProcessMock = vi.hoisted(() => {
  return {
    instances: [] as Array<{
      start: ReturnType<typeof vi.fn>;
      wait: ReturnType<typeof vi.fn>;
      kill: ReturnType<typeof vi.fn>;
    }>,
    waitImpls: [] as Array<() => Promise<unknown>>,
    callIndex: 0,
    reset() {
      this.instances = [];
      this.waitImpls = [];
      this.callIndex = 0;
    },
  };
});

vi.mock("../../executor/index.js", async (importOriginal) => {
  // Keep the real exports (ExecutorError, helpers, etc.) so the orchestrator's
  // recovery-aware retry logic that does `err instanceof ExecutorError`
  // continues to work. Only ClaudeProcess is replaced with a mock so we don't
  // spawn the real Claude CLI in unit tests.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ClaudeProcess: vi.fn().mockImplementation(() => {
      const idx = claudeProcessMock.callIndex++;
      const instance = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockImplementation(async () => {
          const impl = claudeProcessMock.waitImpls[idx];
          if (impl) return impl();
          return defaultSuccessResult();
        }),
        kill: vi.fn().mockResolvedValue(undefined),
      };
      claudeProcessMock.instances.push(instance);
      return instance;
    }),
  };
});

import { ClaudeProcess, ExecutorError, ExecutorErrorCode } from "../../executor/index.js";
import type { Plan, PromptDefinition, RunEvent } from "../../types.js";
import {
  DEFAULT_PROMPT_RETRIES,
  type DbChain,
  type DbClient,
  type DbSingleResult,
  type DbTable,
  type DbVoidResult,
  Orchestrator,
} from "../orchestrator.js";
import { PauseController } from "../pause-controller.js";

function defaultSuccessResult() {
  return {
    exitCode: 0,
    sessionId: "sess-1",
    durationMs: 100,
    finalStatus: "success" as const,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    costUsd: 0.001,
    capturedEvents: [],
  };
}

function defaultErrorResult() {
  return {
    exitCode: 1,
    sessionId: "",
    durationMs: 50,
    finalStatus: "error" as const,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    costUsd: 0,
    errorMessage: "claude error",
    capturedEvents: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock DbClient
// ─────────────────────────────────────────────────────────────────────────────

let executionCounter = 0;

function makeChain(finalSingle?: DbSingleResult): DbChain {
  const voidResult: DbVoidResult = { error: null };
  const singleResult: DbSingleResult = finalSingle ?? {
    data: { id: `exec-${++executionCounter}` },
    error: null,
  };

  // The DbChain extends Promise<DbVoidResult>, so we wrap a Promise and tack
  // .eq / .select / .single onto it so it remains both awaitable and chainable.
  const promise = Promise.resolve(voidResult) as unknown as DbChain;
  (promise as unknown as { eq: DbChain["eq"] }).eq = () => makeChain(singleResult);
  (promise as unknown as { select: DbChain["select"] }).select = () => makeChain(singleResult);
  (promise as unknown as { single: DbChain["single"] }).single = () =>
    Promise.resolve(singleResult);
  return promise;
}

function createMockDb(): DbClient {
  return {
    from(_table: string): DbTable {
      return {
        select: () => makeChain(),
        insert: () => makeChain(),
        update: () => makeChain(),
      };
    },
  };
}

function createCapturingDb(updateCalls: Array<Record<string, unknown>>): DbClient {
  return {
    from(_table: string): DbTable {
      return {
        select: () => makeChain(),
        insert: () => makeChain(),
        update: (data: Record<string, unknown>) => {
          updateCalls.push(data);
          return makeChain();
        },
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makePrompt(id: string, order: number): PromptDefinition {
  return {
    id,
    order,
    filename: `${id}.md`,
    content: `Prompt body ${id}`,
    frontmatter: {
      retries: 0,
    },
  };
}

function makePlan(prompts: PromptDefinition[]): Plan {
  return {
    id: "plan-1",
    name: "Test Plan",
    prompts,
    createdAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  claudeProcessMock.reset();
  vi.mocked(ClaudeProcess).mockClear();
  executionCounter = 0;
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Orchestrator — happy path", () => {
  it("completes 3 prompts successfully and emits expected events", async () => {
    const plan = makePlan([makePrompt("p1", 0), makePrompt("p2", 1), makePrompt("p3", 2)]);
    const events: RunEvent[] = [];

    const orchestrator = new Orchestrator({
      plan,
      workingDir: "/tmp/work",
      runId: "run-1",
      db: createMockDb(),
      pauseController: new PauseController(),
      onEvent: (e) => {
        events.push(e);
      },
    });

    const result = await orchestrator.run();

    expect(result.status).toBe("completed");
    expect(result.completedPrompts).toBe(3);
    expect(result.failedPromptId).toBeUndefined();

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("run.started");
    expect(types.filter((t) => t === "prompt.completed")).toHaveLength(3);
    expect(types[types.length - 1]).toBe("run.completed");
  });
});

describe("Orchestrator — failure path", () => {
  it("fails when prompt 2 errors and retries=0 — emits prompt.failed willRetry=false", async () => {
    const plan = makePlan([makePrompt("p1", 0), makePrompt("p2", 1), makePrompt("p3", 2)]);

    // Process 0 succeeds, process 1 fails (single attempt)
    claudeProcessMock.waitImpls = [
      async () => defaultSuccessResult(),
      async () => defaultErrorResult(),
    ];

    const events: RunEvent[] = [];
    const orchestrator = new Orchestrator({
      plan,
      workingDir: "/tmp/work",
      runId: "run-2",
      db: createMockDb(),
      pauseController: new PauseController(),
      onEvent: (e) => {
        events.push(e);
      },
    });

    const result = await orchestrator.run();

    expect(result.status).toBe("failed");
    expect(result.failedPromptId).toBe("p2");

    const failedEvent = events.find((e) => e.type === "prompt.failed");
    expect(failedEvent).toBeDefined();
    if (failedEvent && failedEvent.type === "prompt.failed") {
      expect(failedEvent.willRetry).toBe(false);
      expect(failedEvent.promptId).toBe("p2");
    }

    expect(events.some((e) => e.type === "run.failed")).toBe(true);
  });
});

describe("Orchestrator — pause/resume", () => {
  it("pauses after first prompt and resumes to completion", async () => {
    const plan = makePlan([makePrompt("p1", 0), makePrompt("p2", 1)]);
    const pauseController = new PauseController();
    const events: RunEvent[] = [];

    let firstCompleted = false;
    const onEvent = (e: RunEvent): void => {
      events.push(e);
      if (e.type === "prompt.completed" && e.promptId === "p1") {
        firstCompleted = true;
        pauseController.pause();
      }
    };

    const orchestrator = new Orchestrator({
      plan,
      workingDir: "/tmp/work",
      runId: "run-3",
      db: createMockDb(),
      pauseController,
      onEvent,
    });

    const runPromise = orchestrator.run();

    // Wait until first prompt completes & we paused.
    await vi.waitFor(() => {
      expect(firstCompleted).toBe(true);
    });

    // Give event loop a tick for the pause check on next iteration.
    await new Promise((r) => setTimeout(r, 50));

    // p2 process should not yet be created (paused before its execution).
    // ClaudeProcess constructor was called once for p1.
    expect(claudeProcessMock.instances.length).toBe(1);
    expect(events.some((e) => e.type === "run.paused")).toBe(true);

    // Resume — run should now finish.
    pauseController.resume();
    const result = await runPromise;

    expect(result.status).toBe("completed");
    expect(result.completedPrompts).toBe(2);
    expect(claudeProcessMock.instances.length).toBe(2);
  });
});

describe("Orchestrator — cancel", () => {
  it("returns status='cancelled' when cancelled before first prompt runs", async () => {
    const plan = makePlan([makePrompt("p1", 0), makePrompt("p2", 1)]);
    const pauseController = new PauseController();
    // Pause first so the orchestrator blocks at waitIfPaused, then cancel.
    pauseController.pause();

    const orchestrator = new Orchestrator({
      plan,
      workingDir: "/tmp/work",
      runId: "run-4",
      db: createMockDb(),
      pauseController,
    });

    const runPromise = orchestrator.run();
    // Cancel immediately on next tick.
    setTimeout(() => pauseController.cancel("test"), 10);

    const result = await runPromise;
    expect(result.status).toBe("cancelled");
    expect(claudeProcessMock.instances.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Resume-tracking DB factory
// ─────────────────────────────────────────────────────────────────────────────

interface ResumeTracking {
  promptExecutionInserts: Array<Record<string, unknown>>;
  runUpdates: Array<Record<string, unknown>>;
}

function createResumeTrackingDb(resumeState?: {
  resume_from_index?: number | null;
  resume_session_id?: string | null;
}): { db: DbClient; tracking: ResumeTracking } {
  const tracking: ResumeTracking = {
    promptExecutionInserts: [],
    runUpdates: [],
  };

  const db: DbClient = {
    from(table: string): DbTable {
      if (table === "runs") {
        return {
          select: () =>
            makeChain({
              data: {
                resume_from_index: resumeState?.resume_from_index ?? null,
                resume_session_id: resumeState?.resume_session_id ?? null,
              },
              error: null,
            }),
          insert: () => makeChain(),
          update: (data: Record<string, unknown>) => {
            tracking.runUpdates.push({ ...data });
            return makeChain();
          },
        };
      }
      return {
        select: () => makeChain(),
        insert: (row: Record<string, unknown>) => {
          if (table === "prompt_executions") {
            tracking.promptExecutionInserts.push({ ...row });
          }
          return makeChain();
        },
        update: () => makeChain(),
      };
    },
  };

  return { db, tracking };
}

function makePromptWithSession(id: string, order: number): PromptDefinition {
  return {
    id,
    order,
    filename: `${id}.md`,
    content: `Prompt body ${id}`,
    frontmatter: {
      retries: 0,
      continueSession: true,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resume tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Orchestrator — resume", () => {
  it("resume_from_index=0 executes all prompts without skipping", async () => {
    const plan = makePlan([makePrompt("p1", 0), makePrompt("p2", 1), makePrompt("p3", 2)]);
    const { db, tracking } = createResumeTrackingDb({ resume_from_index: 0 });

    const result = await new Orchestrator({
      plan,
      workingDir: "/tmp/work",
      runId: "run-resume-0",
      db,
      pauseController: new PauseController(),
    }).run();

    expect(result.status).toBe("completed");
    expect(result.completedPrompts).toBe(3);
    const skipped = tracking.promptExecutionInserts.filter((r) => r["status"] === "skipped");
    expect(skipped).toHaveLength(0);
    expect(claudeProcessMock.instances).toHaveLength(3);
  });

  it("resume_from_index=2 inserts skipped rows for indices 0 and 1", async () => {
    const plan = makePlan([
      makePrompt("p1", 0),
      makePrompt("p2", 1),
      makePrompt("p3", 2),
      makePrompt("p4", 3),
    ]);
    const { db, tracking } = createResumeTrackingDb({ resume_from_index: 2 });

    const result = await new Orchestrator({
      plan,
      workingDir: "/tmp/work",
      runId: "run-resume-2",
      db,
      pauseController: new PauseController(),
    }).run();

    expect(result.status).toBe("completed");

    const skipped = tracking.promptExecutionInserts.filter((r) => r["status"] === "skipped");
    expect(skipped).toHaveLength(2);
    expect(skipped.map((r) => r["prompt_id"])).toContain("p1");
    expect(skipped.map((r) => r["prompt_id"])).toContain("p2");
    expect(skipped[0]?.["error_code"]).toBe("resumed_from_index");

    // Only the 2 non-skipped prompts actually spawned a Claude process.
    expect(claudeProcessMock.instances).toHaveLength(2);
  });

  it("resume_session_id is passed to the first non-skipped prompt", async () => {
    const plan = makePlan([
      makePromptWithSession("p1", 0),
      makePromptWithSession("p2", 1),
      makePromptWithSession("p3", 2),
    ]);
    const { db } = createResumeTrackingDb({
      resume_from_index: 1,
      resume_session_id: "sess_abc",
    });

    await new Orchestrator({
      plan,
      workingDir: "/tmp/work",
      runId: "run-session",
      db,
      pauseController: new PauseController(),
    }).run();

    const ClaudeProcessMocked = vi.mocked(ClaudeProcess);
    // First actual call is for p2 (first non-skipped, index 1).
    expect(ClaudeProcessMocked.mock.calls[0]?.[0]).toMatchObject({
      resumeSessionId: "sess_abc",
    });
    // Second call is for p3 — should use the session returned by p2 ("sess-1").
    expect(ClaudeProcessMocked.mock.calls[1]?.[0]).toMatchObject({
      resumeSessionId: "sess-1",
    });
  });

  it("last_succeeded_prompt_index is updated after each successful prompt", async () => {
    const plan = makePlan([makePrompt("p1", 0), makePrompt("p2", 1), makePrompt("p3", 2)]);
    const { db, tracking } = createResumeTrackingDb();

    const result = await new Orchestrator({
      plan,
      workingDir: "/tmp/work",
      runId: "run-index-track",
      db,
      pauseController: new PauseController(),
    }).run();

    expect(result.status).toBe("completed");
    const indexUpdates = tracking.runUpdates
      .filter((u) => "last_succeeded_prompt_index" in u)
      .map((u) => u["last_succeeded_prompt_index"]);
    expect(indexUpdates).toEqual([0, 1, 2]);
  });

  it("last_succeeded_prompt_index stays at 1 when prompt at index 2 fails terminally", async () => {
    const plan = makePlan([makePrompt("p1", 0), makePrompt("p2", 1), makePrompt("p3", 2)]);
    claudeProcessMock.waitImpls = [
      async () => defaultSuccessResult(),
      async () => defaultSuccessResult(),
      async () => defaultErrorResult(),
    ];
    const { db, tracking } = createResumeTrackingDb();

    const result = await new Orchestrator({
      plan,
      workingDir: "/tmp/work",
      runId: "run-partial-fail",
      db,
      pauseController: new PauseController(),
    }).run();

    expect(result.status).toBe("failed");
    const indexUpdates = tracking.runUpdates
      .filter((u) => "last_succeeded_prompt_index" in u)
      .map((u) => u["last_succeeded_prompt_index"]);
    expect(indexUpdates).toEqual([0, 1]);
  });

  it("resume_from_index and resume_session_id are cleared at run completion", async () => {
    const plan = makePlan([makePrompt("p1", 0), makePrompt("p2", 1)]);
    const { db, tracking } = createResumeTrackingDb({
      resume_from_index: 1,
      resume_session_id: "old-session",
    });

    await new Orchestrator({
      plan,
      workingDir: "/tmp/work",
      runId: "run-cleanup",
      db,
      pauseController: new PauseController(),
    }).run();

    const clearUpdate = tracking.runUpdates.find(
      (u) => "resume_from_index" in u && "resume_session_id" in u,
    );
    expect(clearUpdate).toBeDefined();
    expect(clearUpdate?.["resume_from_index"]).toBeNull();
    expect(clearUpdate?.["resume_session_id"]).toBeNull();
  });
});

describe("Orchestrator — error_code persistence", () => {
  it("preserves raw ExecutorError code when classifier returns unknown category", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const db = createCapturingDb(updateCalls);

    claudeProcessMock.waitImpls = [
      async () => {
        throw new ExecutorError("CUSTOM_FAIL_1234" as ExecutorErrorCode, "test fail");
      },
    ];

    const orchestrator = new Orchestrator({
      plan: makePlan([makePrompt("p1", 0)]),
      workingDir: "/tmp/work",
      runId: "run-errcode-1",
      db,
      pauseController: new PauseController(),
    });

    const result = await orchestrator.run();

    expect(result.status).toBe("failed");
    const execUpdate = updateCalls.find((d) => d["error_code"] !== undefined);
    expect(execUpdate?.["error_code"]).toBe("CUSTOM_FAIL_1234");
  });

  it("persists error_code='IDLE' for IDLE_STALL errors", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const db = createCapturingDb(updateCalls);

    claudeProcessMock.waitImpls = [
      async () => {
        throw new ExecutorError(ExecutorErrorCode.IDLE_STALL, "idle stall");
      },
    ];

    const orchestrator = new Orchestrator({
      plan: makePlan([makePrompt("p1", 0)]),
      workingDir: "/tmp/work",
      runId: "run-errcode-2",
      db,
      pauseController: new PauseController(),
    });

    const result = await orchestrator.run();

    expect(result.status).toBe("failed");
    const execUpdate = updateCalls.find((d) => d["error_code"] !== undefined);
    expect(execUpdate?.["error_code"]).toBe("IDLE");
  });
});

// ───────────────────────────────���─────────────────────────────────────────────
// Retries default + backoff
// ──────────────────────────────────────────────────��──────────────────────────

function makePromptNoRetries(id: string, order: number): PromptDefinition {
  return {
    id,
    order,
    filename: `${id}.md`,
    content: `Prompt body ${id}`,
    frontmatter: {},
  };
}

describe("Orchestrator — retries default and backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses DEFAULT_PROMPT_RETRIES when frontmatter.retries is not set", async () => {
    const plan = makePlan([makePromptNoRetries("p1", 0)]);
    claudeProcessMock.waitImpls = [
      async () => {
        throw new ExecutorError(ExecutorErrorCode.TIMEOUT, "t1");
      },
      async () => {
        throw new ExecutorError(ExecutorErrorCode.TIMEOUT, "t2");
      },
      async () => {
        throw new ExecutorError(ExecutorErrorCode.TIMEOUT, "t3");
      },
    ];

    const orchestrator = new Orchestrator({
      plan,
      workingDir: "/tmp/work",
      runId: "run-default-retries",
      db: createMockDb(),
      pauseController: new PauseController(),
    });

    const runPromise = orchestrator.run();
    await vi.runAllTimersAsync();
    const result = await runPromise;

    expect(result.status).toBe("failed");
    expect(claudeProcessMock.instances.length).toBe(DEFAULT_PROMPT_RETRIES + 1);
  });

  it("makes exactly 1 attempt when frontmatter.retries=0", async () => {
    const plan = makePlan([makePrompt("p1", 0)]);
    claudeProcessMock.waitImpls = [
      async () => {
        throw new ExecutorError(ExecutorErrorCode.TIMEOUT, "timeout");
      },
    ];

    const orchestrator = new Orchestrator({
      plan,
      workingDir: "/tmp/work",
      runId: "run-retries-0",
      db: createMockDb(),
      pauseController: new PauseController(),
    });

    const runPromise = orchestrator.run();
    await vi.runAllTimersAsync();
    const result = await runPromise;

    expect(result.status).toBe("failed");
    expect(claudeProcessMock.instances.length).toBe(1);
  });

  it("makes exactly 6 attempts when frontmatter.retries=5", async () => {
    const prompt: PromptDefinition = {
      ...makePromptNoRetries("p1", 0),
      frontmatter: { retries: 5 },
    };
    const plan = makePlan([prompt]);
    claudeProcessMock.waitImpls = Array.from({ length: 6 }, () => async () => {
      throw new ExecutorError(ExecutorErrorCode.TIMEOUT, "timeout");
    });

    const orchestrator = new Orchestrator({
      plan,
      workingDir: "/tmp/work",
      runId: "run-retries-5",
      db: createMockDb(),
      pauseController: new PauseController(),
    });

    const runPromise = orchestrator.run();
    await vi.runAllTimersAsync();
    const result = await runPromise;

    expect(result.status).toBe("failed");
    expect(claudeProcessMock.instances.length).toBe(6);
  });

  it("does not retry AUTH_INVALID even with retries=10", async () => {
    const prompt: PromptDefinition = {
      ...makePromptNoRetries("p1", 0),
      frontmatter: { retries: 10 },
    };
    const plan = makePlan([prompt]);
    claudeProcessMock.waitImpls = [
      async () => {
        throw new ExecutorError(ExecutorErrorCode.AUTH_INVALID, "auth failed");
      },
    ];

    const orchestrator = new Orchestrator({
      plan,
      workingDir: "/tmp/work",
      runId: "run-auth-invalid",
      db: createMockDb(),
      pauseController: new PauseController(),
    });

    const runPromise = orchestrator.run();
    await vi.runAllTimersAsync();
    const result = await runPromise;

    expect(result.status).toBe("failed");
    expect(claudeProcessMock.instances.length).toBe(1);
  });

  it("waits at least retryAfter ms before retrying a RATE_LIMITED error", async () => {
    const plan = makePlan([makePromptNoRetries("p1", 0)]);
    // First attempt: RATE_LIMITED with 5s Retry-After. Second: success.
    claudeProcessMock.waitImpls = [
      async () => {
        throw new ExecutorError(ExecutorErrorCode.RATE_LIMITED, "rate limited", {
          originalError: { retryAfter: 5 }, // 5s → 5000ms
        });
      },
      async () => defaultSuccessResult(),
      async () => defaultSuccessResult(),
    ];

    const orchestrator = new Orchestrator({
      plan,
      workingDir: "/tmp/work",
      runId: "run-rate-limited",
      db: createMockDb(),
      pauseController: new PauseController(),
    });

    const runPromise = orchestrator.run();

    // At 4999ms the sleep(5000ms) has not yet expired — still on first attempt.
    await vi.advanceTimersByTimeAsync(4999);
    expect(claudeProcessMock.instances.length).toBe(1);

    // Advance past the 5000ms boundary — sleep resolves, second attempt starts.
    await vi.advanceTimersByTimeAsync(1002);
    await vi.runAllTimersAsync();
    const result = await runPromise;

    expect(result.status).toBe("completed");
    expect(claudeProcessMock.instances.length).toBe(2);
  });

  it("backoff delays are exponential-jitter and within policy bounds", async () => {
    const plan = makePlan([makePromptNoRetries("p1", 0)]);
    // 3 TIMEOUT failures → 2 backoff sleeps between attempts.
    claudeProcessMock.waitImpls = [
      async () => {
        throw new ExecutorError(ExecutorErrorCode.TIMEOUT, "t1");
      },
      async () => {
        throw new ExecutorError(ExecutorErrorCode.TIMEOUT, "t2");
      },
      async () => {
        throw new ExecutorError(ExecutorErrorCode.TIMEOUT, "t3");
      },
    ];

    // Pin Math.random to 0.9 for deterministic delays:
    // attempt 1: floor(0.9 * 1000 * 2^0) = 900ms  (≤ initialDelayMs=1000)
    // attempt 2: floor(0.9 * 1000 * 2^1) = 1800ms (≤ 2000)
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.9);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const orchestrator = new Orchestrator({
      plan,
      workingDir: "/tmp/work",
      runId: "run-backoff",
      db: createMockDb(),
      pauseController: new PauseController(),
    });

    const runPromise = orchestrator.run();
    await vi.runAllTimersAsync();
    const result = await runPromise;

    expect(result.status).toBe("failed");
    expect(claudeProcessMock.instances.length).toBe(3);

    // Extract backoff delays: filter out cancel-polling (500ms interval) and
    // any 0-delay calls. With Math.random=0.9, expected 900 and 1800.
    const backoffDelays = setTimeoutSpy.mock.calls
      .map(([, d]) => d as number)
      .filter((d): d is number => typeof d === "number" && d > 0 && d !== 500);

    expect(backoffDelays.length).toBeGreaterThanOrEqual(2);
    // Each delay must be within [0, maxDelayMs=60_000]
    for (const d of backoffDelays) {
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(60_000);
    }
    // First backoff ≤ initialDelayMs * multiplier^0 = 1000
    expect(backoffDelays[0]).toBeLessThanOrEqual(1_000);
    // Second backoff ≤ initialDelayMs * multiplier^1 = 2000
    expect(backoffDelays[1]).toBeLessThanOrEqual(2_000);

    randomSpy.mockRestore();
    setTimeoutSpy.mockRestore();
  });
});

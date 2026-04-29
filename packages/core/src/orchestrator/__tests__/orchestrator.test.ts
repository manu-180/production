import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../../executor/index.js", async () => {
  return {
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

import type { Plan, PromptDefinition, RunEvent } from "../../types.js";
import {
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

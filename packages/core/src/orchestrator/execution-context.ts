/**
 * Conductor — Execution Context
 *
 * Mutable state shared across prompts within a single run.
 * The orchestrator reads/writes this as it executes each prompt sequentially.
 */

import type { TokenUsage } from "../types.js";

const MAX_RESULT_SNIPPET_LENGTH = 500;

/**
 * Shared mutable context that flows between prompts within a single run.
 */
export interface ExecutionContext {
  /** Stable identifier for the current run. */
  runId: string;

  /** Absolute working directory the run executes against. */
  workingDir: string;

  /**
   * Last successful Claude session ID, used by the executor to pass `--resume`
   * to subsequent prompts that opt into session continuity. `null` when the
   * run has not yet produced a successful session.
   */
  lastSessionId: string | null;

  /** Accumulated token usage across all executed prompts so far. */
  accumulatedUsage: TokenUsage;

  /** Accumulated cost in USD across all executed prompts so far. */
  accumulatedCostUsd: number;

  /** Index (0-based) of the currently executing prompt within the plan. */
  currentPromptIndex: number;

  /**
   * Map of `promptId` to a short summary or result snippet (truncated).
   * Useful for downstream prompts that need lightweight context injection.
   */
  promptResults: Map<string, string>;
}

/**
 * Creates a fresh ExecutionContext for a new run.
 */
export function createExecutionContext(runId: string, workingDir: string): ExecutionContext {
  return {
    runId,
    workingDir,
    lastSessionId: null,
    accumulatedUsage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
    },
    accumulatedCostUsd: 0,
    currentPromptIndex: 0,
    promptResults: new Map<string, string>(),
  };
}

/**
 * Merges a single prompt's usage and cost into the running totals.
 */
export function addUsage(ctx: ExecutionContext, usage: TokenUsage, costUsd: number): void {
  ctx.accumulatedUsage.input += usage.input;
  ctx.accumulatedUsage.output += usage.output;
  ctx.accumulatedUsage.cacheRead += usage.cacheRead;
  ctx.accumulatedUsage.cacheCreation += usage.cacheCreation;
  ctx.accumulatedCostUsd += costUsd;
}

/**
 * Records a prompt result snippet, truncated to {@link MAX_RESULT_SNIPPET_LENGTH}
 * characters to keep the context map bounded.
 */
export function recordPromptResult(ctx: ExecutionContext, promptId: string, result: string): void {
  const snippet =
    result.length > MAX_RESULT_SNIPPET_LENGTH ? result.slice(0, MAX_RESULT_SNIPPET_LENGTH) : result;
  ctx.promptResults.set(promptId, snippet);
}

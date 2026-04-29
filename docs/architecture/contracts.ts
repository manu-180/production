/**
 * Conductor — Type Contracts (Phase 01: Architecture)
 *
 * This file is the canonical, standalone source of truth for the TypeScript
 * interfaces consumed across the Conductor system: Plan ingestion, the
 * Executor that spawns `claude -p --output-format stream-json`, the Guardian
 * agent that auto-decides ambiguous prompts, the streaming event bus
 * (SSE / Supabase Realtime), and the dashboard.
 *
 * No imports, no implementation — types only. Compiles with `tsc --noEmit --strict`.
 */

// Date fields use ISO 8601 strings (e.g. "2026-04-29T12:00:00.000Z") at the contract boundary.

// ─────────────────────────────────────────────────────────────────────────────
// Plan & Prompts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A Plan is the top-level orchestration unit: an ordered list of prompts
 * to be executed sequentially by Conductor against a single working directory.
 */
export interface Plan {
  id: string;
  name: string;
  description?: string;
  prompts: PromptDefinition[];
  defaultWorkingDir?: string;
  createdAt: string;
}

/**
 * A single prompt within a Plan, parsed from a Markdown file with
 * YAML frontmatter. `order` determines execution position.
 */
export interface PromptDefinition {
  id: string;
  order: number;
  filename: string;
  content: string;
  frontmatter: PromptFrontmatter;
}

/**
 * YAML frontmatter declared at the top of each prompt file.
 * Controls per-prompt execution policy (session reuse, tools, budgets, retries).
 */
export interface PromptFrontmatter {
  title?: string;
  continueSession?: boolean; // default false: each prompt starts a new session
  allowedTools?: string[];
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
  maxTurns?: number;
  maxBudgetUsd?: number;
  timeoutMs?: number;
  retries?: number; // default 2
  requiresApproval?: boolean; // pause point before execution
  rollbackOnFail?: boolean; // default true
}

// ─────────────────────────────────────────────────────────────────────────────
// Runs & Executions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A Run is a single end-to-end execution of a Plan.
 * It owns the working directory, the git checkpoint branch, and aggregate
 * cost / token totals for the whole sequence.
 */
export interface Run {
  id: string;
  planId: string;
  workingDir: string;
  status: RunStatus;
  startedAt?: string;
  finishedAt?: string;
  currentPromptIndex?: number;
  runBranch: string; // git branch for this run: conductor/run-{runId}
  totalCostUsd: number;
  totalTokens: TokenUsage;
}

/** Lifecycle states of a Run. */
export type RunStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * One attempt to execute a single Prompt within a Run.
 * Invariants:
 *   - startedAt is set when status transitions to 'running'
 *   - finishedAt is set when status transitions to 'succeeded' | 'failed' | 'skipped' | 'rolled_back'
 */
export interface PromptExecution {
  id: string;
  runId: string;
  promptId: string;
  status: PromptExecutionStatus;
  attempt: number;
  startedAt?: string;
  finishedAt?: string;
  sessionId?: string; // Claude session id for --resume
  checkpointSha?: string; // git commit hash after success
  costUsd: number;
  tokens: TokenUsage;
  error?: ExecutionError;
}

/** Lifecycle states of a single PromptExecution attempt. */
export type PromptExecutionStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'rolled_back';

/**
 * Structured error attached to a failed PromptExecution.
 * `raw` carries the original stderr / exception text for debugging.
 */
export interface ExecutionError {
  code: 'TIMEOUT' | 'NON_ZERO_EXIT' | 'PARSE_ERROR' | 'AUTH_FAILED' | 'GUARDIAN_FAILED' | 'UNKNOWN';
  message: string;
  raw?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Usage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Token accounting for a single prompt execution or aggregated across a run.
 * Anthropic billing distinguishes cache reads from cache creation.
 */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number; // tokens served from cache (cheaper)
  cacheCreation: number; // tokens written to cache (more expensive)
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardian
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record of an autonomous decision made by the Guardian agent when Claude
 * paused on an ambiguous question. Stored for audit and human review.
 */
export interface GuardianDecision {
  id: string;
  promptExecutionId: string;
  questionDetected: string;
  reasoning: string;
  decision: string;
  confidence: number; // 0-1
  strategy: GuardianStrategy; // which tier produced this decision
  decidedAt: string;
  reviewedByHuman?: boolean;
}

/** Which tier the Guardian used: fast regex-based heuristic or full LLM call */
export type GuardianStrategy = 'heuristic' | 'llm';

// ─────────────────────────────────────────────────────────────────────────────
// Streaming Events (SSE / Supabase Realtime)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discriminated union of all events emitted from the Executor through
 * the event bus to the dashboard. Each variant is fully self-describing
 * so consumers can switch on `type` without ambiguity.
 */
export type RunEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'prompt.started'; promptId: string; index: number; total: number }
  | {
      type: 'prompt.output';
      promptId: string;
      chunk: string;
      channel: 'stdout' | 'stderr';
    }
  | { type: 'prompt.tool_use'; promptId: string; tool: string; input: unknown }
  | {
      type: 'prompt.tool_result';
      promptId: string;
      tool: string;
      output: unknown;
    }
  | { type: 'prompt.guardian_intervention'; decision: GuardianDecision }
  | { type: 'prompt.checkpoint_created'; promptId: string; sha: string }
  | {
      type: 'prompt.completed';
      promptId: string;
      tokens: TokenUsage;
      costUsd: number;
    }
  | {
      type: 'prompt.failed';
      promptId: string;
      error: string;
      willRetry: boolean;
    }
  | { type: 'run.paused'; reason: string }
  | { type: 'run.completed'; totalCostUsd: number; durationMs: number }
  | { type: 'run.failed'; failedAtPromptId: string; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// Configuration — Executor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration passed to the Executor when spawning the Claude CLI.
 * Mirrors the supported `claude -p` flags one-to-one.
 */
export interface ExecutorConfig {
  claudeBinary: string; // path to claude CLI binary
  outputFormat: 'stream-json' | 'json' | 'text';
  permissionMode: NonNullable<PromptFrontmatter['permissionMode']>;
  allowedTools: string[];
  appendSystemPrompt?: string;
  maxTurns?: number;
  timeoutMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration — Recovery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * System-wide default retry behavior for Prompt executions.
 * Individual prompts can override maxAttempts via PromptFrontmatter.retries.
 */
export interface RetryPolicy {
  maxAttempts: number; // default 3 (1 initial + 2 retries)
  backoffMs: number; // initial backoff, doubles each attempt
  maxBackoffMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Types — Views & Composites
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lightweight projection of a Plan for list views in the dashboard.
 * Drops the heavy `prompts[]` payload, keeping only counts and metadata.
 */
export interface PlanSummary {
  id: string;
  name: string;
  description?: string;
  promptCount: number;
  createdAt: string;
}

/**
 * Detail view: a Run joined with the full ordered list of its PromptExecutions.
 * Used by the dashboard's run-detail screen and the JSON export endpoint.
 */
export interface RunWithExecutions extends Run {
  executions: PromptExecution[];
}

/**
 * Snapshot of a Run plus the most recent event, for the live dashboard
 * "current activity" panel. Decoupled from the event log so the consumer
 * doesn't need to replay history to render the latest state.
 */
export interface RunSnapshot {
  run: Run;
  currentExecution?: PromptExecution;
  lastEvent?: RunEvent;
}

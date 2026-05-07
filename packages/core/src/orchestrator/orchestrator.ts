/**
 * Conductor — Orchestrator
 *
 * Coordinates sequential execution of a {@link Plan}'s prompts via the Claude
 * CLI. Owns the run lifecycle: pause/resume/cancel signaling, retry/backoff,
 * progress emission, optional checkpointing, and DB state transitions for the
 * `runs` and `prompt_executions` tables.
 *
 * Phases not yet implemented (Guardian — phase 07; CheckpointManager — phase
 * 08) are accepted as optional dependencies via {@link OrchestratorOptions}.
 * Guardian is a stub here (held but never invoked); CheckpointManager IS
 * called when supplied.
 */

import {
  ClaudeProcess,
  type ClaudeProcessOptions,
  type ExecutionResult,
  ExecutorError,
  type ExecutorErrorCode,
  isAssistantEvent,
} from "../executor/index.js";
import type { ClaudeStreamEvent, TokenUsage as ExecutorTokenUsage } from "../executor/index.js";
import type { GuardianRunner } from "../guardian/guardian-runner.js";
import { startPromptHeartbeat } from "../observability/prompt-heartbeat.js";
import {
  type ClassifiedError,
  DEFAULT_RETRY_POLICY,
  classifyError,
  nextDelay,
} from "../recovery/index.js";
import type { GuardianDecision, Plan, PromptDefinition, RunEvent, TokenUsage } from "../types.js";
import { type ExecutionContext, addUsage, createExecutionContext } from "./execution-context.js";
import { CancelledError, type PauseController } from "./pause-controller.js";
import { ProgressEmitter } from "./progress-emitter.js";
import { groupIntoWaves, runWithConcurrencyLimit } from "./wave-grouper.js";

/**
 * Default retries per prompt when frontmatter doesn't specify.
 * 1 initial attempt + 2 retries = 3 total attempts (aligned with DEFAULT_RETRY_POLICY.maxAttempts).
 */
export const DEFAULT_PROMPT_RETRIES = 2;

/**
 * Maximum sibling Claude CLI processes to spawn concurrently within a single
 * parallel wave. Capped at 2 (down from 3) because on Windows the CLI is
 * spawned through a `cmd.exe /c claude.cmd` shell wrapper, and three
 * concurrent processes were observed contending on the OAuth token refresh
 * — typically two of three would hang in `Esperando salida...` while the
 * third proceeded. Two concurrent processes have been stable.
 */
export const PARALLEL_CONCURRENCY_CAP = 2;

/**
 * Idle-timeout floor applied to siblings in a parallel wave. Tighter than
 * the executor default (90s) so a hung sibling fails its attempt fast and
 * the retry path can recover, rather than burning the run's wall-clock
 * budget on a stuck process. Honors any explicit per-prompt
 * `idleTimeoutMs` if it's already lower.
 */
export const PARALLEL_IDLE_TIMEOUT_MS = 45_000;

/**
 * Maximum stagger applied to a sibling's start in a parallel wave. Each
 * sibling sleeps a random interval in `[0, PARALLEL_STAGGER_MAX_MS]` before
 * spawning Claude — prevents two CLI processes from hitting the OAuth
 * refresh endpoint in the same millisecond on retry, which is what
 * triggers contention/hangs on Windows.
 */
export const PARALLEL_STAGGER_MAX_MS = 1_500;

// ─────────────────────────────────────────────────────────────────────────────
// Phase-stub interfaces (CheckpointManager: phase 08)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checkpoint manager — used to commit a git checkpoint after each successful
 * prompt and to roll back to the last good SHA on terminal failure when a
 * prompt sets `rollbackOnFail: true`.
 */
export interface CheckpointManager {
  /** Commits a checkpoint for a successful execution and returns the SHA. */
  commit(promptId: string, executionId: string): Promise<string>;
  /** Reverts the working tree to the given SHA. */
  rollback(sha: string): Promise<void>;
  /**
   * Optional: set per-prompt execution stats just before {@link commit}, so
   * implementations can include them in the commit message body. Backwards-
   * compatible: callers that don't supply an implementation are unaffected.
   */
  setExecutionMeta?(
    promptId: string,
    meta: {
      tokensIn: number;
      tokensOut: number;
      tokensCache: number;
      costUsd: number;
      durationMs: number;
      toolsUsed: string[];
      guardianDecisions: number;
    },
  ): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB client interface — minimal shape needed by the orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of a "void" DB mutation (insert/update without `.select()`).
 * Mirrors `PostgrestSingleResponse<null>` from `@supabase/supabase-js`.
 */
export interface DbVoidResult {
  error: unknown;
}

/**
 * Result of a `.single()` DB read (insert/select returning one row).
 * Mirrors `PostgrestSingleResponse<T>` from `@supabase/supabase-js`.
 */
export interface DbSingleResult {
  data: Record<string, unknown> | null;
  error: unknown;
}

/**
 * Chainable query builder. Extends `Promise<DbVoidResult>` so that the same
 * builder can either be `await`ed directly (for void mutations) or further
 * refined with `.eq()` / `.select()` / `.single()` calls before awaiting.
 *
 * Extending `Promise` (not just `PromiseLike`) keeps the shape compatible
 * with {@link ProgressEmitter}'s `SupabaseLikeClient`, whose `.insert()`
 * returns `Promise<{ error: unknown }>`.
 */
export interface DbChain extends Promise<DbVoidResult> {
  eq(col: string, val: string): DbChain;
  select(cols?: string): DbChain;
  single(): Promise<DbSingleResult>;
}

export interface DbTable {
  select(cols?: string): DbChain;
  insert(row: Record<string, unknown>): DbChain;
  update(data: Record<string, unknown>): DbChain;
}

export interface DbClient {
  from(table: string): DbTable;
}

// ─────────────────────────────────────────────────────────────────────────────
// Result and option types
// ─────────────────────────────────────────────────────────────────────────────

export type RunResultStatus = "completed" | "failed" | "cancelled";

/**
 * Final outcome of {@link Orchestrator.run}.
 */
export interface RunResult {
  status: RunResultStatus;
  totalCostUsd: number;
  totalDurationMs: number;
  completedPrompts: number;
  failedPromptId?: string;
  error?: string;
}

/**
 * Constructor options for {@link Orchestrator}.
 */
export interface OrchestratorOptions {
  plan: Plan;
  workingDir: string;
  runId: string;
  db: DbClient;
  pauseController: PauseController;
  /** Optional event tap (e.g. SSE). Errors thrown by the handler are swallowed. */
  onEvent?: (event: RunEvent) => void;
  /**
   * Guardian runner. When supplied, the orchestrator injects guidelines into
   * each prompt and invokes the runner after every Claude turn so it can
   * auto-answer questions on the user's behalf.
   */
  guardian?: GuardianRunner;
  /** Optional checkpoint manager (phase 08+). */
  checkpoint?: CheckpointManager;
  /**
   * Set of prompt ids that succeeded in a previous run of the same plan.
   * The orchestrator skips these (marks them `skipped` with reason
   * `already_done`) instead of calling Claude. Use to avoid duplicate work
   * and duplicate commits when re-running a plan whose earlier run was
   * cancelled or partially failed. Empty/undefined = no skipping.
   */
  alreadyDonePromptIds?: ReadonlySet<string>;
  /**
   * Maximum sibling Claude CLI processes to spawn concurrently within a
   * single parallel wave. Defaults to {@link PARALLEL_CONCURRENCY_CAP} (2).
   * Tests may set to 1 to serialize, or higher to exercise specific limits.
   */
  parallelConcurrencyCap?: number;
  /**
   * Maximum random jitter applied to a sibling's start in a parallel wave
   * (milliseconds). Each sibling sleeps `[0, max]` ms before spawning Claude.
   * Defaults to {@link PARALLEL_STAGGER_MAX_MS}. Set to 0 in tests to make
   * spawn order deterministic.
   */
  parallelStaggerMaxMs?: number;
  /**
   * Idle-timeout floor (ms) applied to siblings in a parallel wave. Defaults
   * to {@link PARALLEL_IDLE_TIMEOUT_MS}. Tests can set to 0 to disable the
   * override and use the executor's default.
   */
  parallelIdleTimeoutMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps the executor's snake_case {@link ExecutorTokenUsage} into the canonical
 * camelCase {@link TokenUsage} used by the rest of the system.
 */
export function mapTokenUsage(usage: ExecutorTokenUsage): TokenUsage {
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheCreation: usage.cache_creation_input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
  };
}

/**
 * Builds {@link ClaudeProcessOptions} for a single prompt by combining its
 * frontmatter with the run's working directory and (optionally) the resumable
 * session id from the previous successful prompt.
 */
export function buildClaudeOptions(
  prompt: PromptDefinition,
  context: ExecutionContext,
): ClaudeProcessOptions {
  const fm = prompt.frontmatter;
  const opts: ClaudeProcessOptions = {
    prompt: prompt.content,
    workingDir: context.workingDir,
    permissionMode: fm.permissionMode ?? "bypassPermissions",
  };
  if (fm.allowedTools && fm.allowedTools.length > 0) {
    opts.allowedTools = fm.allowedTools;
  }
  if (typeof fm.maxTurns === "number") {
    opts.maxTurns = fm.maxTurns;
  }
  if (typeof fm.timeoutMs === "number") {
    opts.timeoutMs = fm.timeoutMs;
  }
  if (typeof fm.idleTimeoutMs === "number") {
    opts.idleTimeoutMs = fm.idleTimeoutMs;
  }
  if (typeof fm.maxBudgetUsd === "number") {
    opts.maxBudgetUsd = fm.maxBudgetUsd;
  }
  if (fm.continueSession === true && context.lastSessionId !== null) {
    opts.resumeSessionId = context.lastSessionId;
  }
  return opts;
}

/**
 * Returns a shallow copy of the process environment. Centralized here so
 * callers can later inject scrubbed envs (e.g. dropping unrelated vars)
 * without changing the orchestrator's call sites. Returning a copy prevents
 * downstream mutation from leaking into the parent process.
 */
export function buildEnv(): NodeJS.ProcessEnv {
  return { ...process.env };
}

function isoNow(): string {
  return new Date().toISOString();
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Recovery-aware retry decision. Classifies the error using the recovery
 * primitives, returning whether to retry plus the wait duration to apply.
 *
 * - {@link GuardianLoopError}: terminal — `{ retry: false, classified: null }`.
 * - {@link ExecutorError}: classified — honors `retryable` and `waitMs`
 *   (rate-limit hint or transient default).
 * - Anything else: treated as transient unknown — retryable with default
 *   exponential backoff. Same generosity the legacy `backoff()` had.
 */
function buildErrorCode(args: {
  isGuardianLoop: boolean;
  classified: ClassifiedError | null;
  executorErrCode: ExecutorErrorCode | string | null;
}): string {
  if (args.isGuardianLoop) return "GUARDIAN_LOOP";
  if (args.classified !== null && args.classified.category !== "unknown") {
    return args.classified.category.toUpperCase();
  }
  if (typeof args.executorErrCode === "string" && args.executorErrCode.length > 0) {
    return args.executorErrCode;
  }
  return "UNKNOWN";
}

function classifyRetry(
  err: unknown,
  attempt: number,
): { retry: boolean; waitMs: number; classified: ClassifiedError | null } {
  if (err instanceof GuardianLoopError) {
    return { retry: false, waitMs: 0, classified: null };
  }
  if (err instanceof ExecutorError) {
    const classified = classifyError(err);
    if (!classified.retryable) {
      return { retry: false, waitMs: 0, classified };
    }
    const waitMs = classified.waitMs ?? nextDelay(DEFAULT_RETRY_POLICY, attempt);
    return { retry: true, waitMs, classified };
  }
  // Unknown error shape — keep retrying with default exponential-jitter backoff.
  return {
    retry: true,
    waitMs: nextDelay(DEFAULT_RETRY_POLICY, attempt),
    classified: null,
  };
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

/**
 * Sentinel error thrown when the Guardian intervenes too many times for a
 * single prompt. Surfaced to callers via `GUARDIAN_LOOP` in the
 * `prompt_executions.error_code` column and the run-level error.
 */
export class GuardianLoopError extends Error {
  readonly code = "GUARDIAN_LOOP" as const;
  constructor(message: string) {
    super(message);
    this.name = "GuardianLoopError";
  }
}

/**
 * Walks the captured stream events to extract the text of the last assistant
 * message. Falls back to the executor's top-level `result` field when no
 * assistant text is present in the captured events (e.g. when capture is
 * disabled or the stream only contained tool blocks).
 */
function extractLastAssistantText(result: ExecutionResult): {
  text: string;
  hasToolUse: boolean;
} {
  let lastText = "";
  let hasToolUse = false;

  for (const event of result.capturedEvents) {
    if (!isAssistantEvent(event)) continue;
    const blocks = event.message.content;
    let textForThisMessage = "";
    let toolUseInThisMessage = false;
    for (const block of blocks) {
      const b = block as { type: string; text?: unknown };
      if (b.type === "text" && typeof b.text === "string") {
        textForThisMessage += textForThisMessage.length > 0 ? `\n${b.text}` : b.text;
      } else if (b.type === "tool_use") {
        toolUseInThisMessage = true;
      }
    }
    if (textForThisMessage.length > 0 || toolUseInThisMessage) {
      lastText = textForThisMessage;
      hasToolUse = toolUseInThisMessage;
    }
  }

  return { text: lastText, hasToolUse };
}

/**
 * Returns the last `n` assistant message text bodies from the captured events,
 * oldest-first. Used to give the Guardian decision strategies a bit of context
 * beyond the very last turn.
 */
function extractRecentAssistantTexts(events: ClaudeStreamEvent[], n: number): string[] {
  const texts: string[] = [];
  for (const event of events) {
    if (!isAssistantEvent(event)) continue;
    let text = "";
    for (const block of event.message.content) {
      const b = block as { type: string; text?: unknown };
      if (b.type === "text" && typeof b.text === "string") {
        text += text.length > 0 ? `\n${b.text}` : b.text;
      }
    }
    if (text.length > 0) {
      texts.push(text);
    }
  }
  return texts.slice(-n);
}

/**
 * First N characters of the prompt content, used as context for the decision
 * strategies. Trimmed and collapsed so the snippet is readable in logs.
 */
function buildPromptContext(prompt: PromptDefinition, max = 200): string {
  const flat = prompt.content.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Updates the `runs` table status and the matching timestamp column. Errors
 * are logged but never thrown — telemetry must not break the run.
 */
export async function updateRunStatus(
  runId: string,
  status: "running" | "completed" | "failed" | "cancelled" | "paused",
  db: DbClient,
): Promise<void> {
  const data: Record<string, unknown> = { status };
  if (status === "running") {
    data["started_at"] = isoNow();
  } else if (status === "completed" || status === "failed" || status === "cancelled") {
    data["finished_at"] = isoNow();
  }
  try {
    const { error } = await db.from("runs").update(data).eq("id", runId);
    if (error !== null && error !== undefined) {
      console.error(`[Orchestrator] updateRunStatus(${runId}, ${status}) error:`, error);
    }
  } catch (err) {
    console.error(`[Orchestrator] updateRunStatus(${runId}, ${status}) threw:`, err);
  }
}

/**
 * Creates (or claims) a `prompt_executions` row in `running` state and
 * returns its id. Throws if the row could not be created — without an
 * executionId we cannot later record the outcome.
 *
 * Behavior:
 *  - On the first attempt for a prompt within a run, the SQL function
 *    `enqueue_run` already inserted a stub row with `status='pending'`.
 *    We claim that stub by flipping it to `running` so the dashboard
 *    doesn't end up with phantom "pendiente" rows shadowing each
 *    successful execution.
 *  - On retries (or when the stub is missing for any reason), we INSERT
 *    a fresh row.
 */
export async function createPromptExecution(
  prompt: PromptDefinition,
  attempt: number,
  runId: string,
  db: DbClient,
): Promise<string> {
  const startedAt = isoNow();

  // First attempt — try to claim the pre-created `pending` stub from
  // enqueue_run. Filtering on status='pending' makes this idempotent: if
  // a previous worker already claimed it the update affects zero rows
  // and we fall through to the INSERT branch.
  if (attempt === 1) {
    try {
      const { data, error } = await db
        .from("prompt_executions")
        .update({
          attempt,
          status: "running",
          started_at: startedAt,
          last_progress_at: startedAt,
        })
        .eq("run_id", runId)
        .eq("prompt_id", prompt.id)
        .eq("status", "pending")
        .select("id")
        .single();

      if (error === null || error === undefined) {
        const id = data?.["id"];
        if (typeof id === "string" && id.length > 0) {
          return id;
        }
      }
      // No stub matched (PGRST116 / single() returned no row) — fall through
      // to INSERT. This covers retries triggered before the orchestrator
      // booted on a fresh worker, and any data drift.
    } catch {
      // Best-effort claim: any unexpected error here means we just create
      // a new row instead. The INSERT path below is the source of truth.
    }
  }

  const row: Record<string, unknown> = {
    run_id: runId,
    prompt_id: prompt.id,
    attempt,
    status: "running",
    started_at: startedAt,
    last_progress_at: startedAt,
  };
  const { data, error } = await db.from("prompt_executions").insert(row).select("id").single();
  if (error !== null && error !== undefined) {
    throw new Error(`createPromptExecution failed: ${errorMessage(error)}`);
  }
  const id = data?.["id"];
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("createPromptExecution: insert returned no id");
  }
  return id;
}

/**
 * Updates a `prompt_executions` row with the outcome of a single attempt.
 * On success the cost/token/duration/checkpoint columns are populated; on
 * failure the status is flipped and an error message is recorded. Errors
 * coming from the DB are logged but not thrown.
 */
export async function updatePromptExecution(
  executionId: string,
  status: "succeeded" | "failed",
  result: ExecutionResult | null,
  sha: string,
  db: DbClient,
  errorInfo?: { code: string; message: string; raw?: string },
): Promise<void> {
  const data: Record<string, unknown> = {
    status,
    finished_at: isoNow(),
  };

  if (status === "succeeded" && result !== null) {
    const usage = mapTokenUsage(result.usage);
    data["cost_usd"] = result.costUsd;
    data["input_tokens"] = usage.input;
    data["output_tokens"] = usage.output;
    data["cache_tokens"] = usage.cacheRead + usage.cacheCreation;
    data["duration_ms"] = result.durationMs;
    if (sha.length > 0) data["checkpoint_sha"] = sha;
    if (result.sessionId.length > 0) data["claude_session_id"] = result.sessionId;
  } else if (status === "failed") {
    data["error_code"] = errorInfo?.code ?? "UNKNOWN";
    data["error_message"] = errorInfo?.message ?? "unknown error";
    if (errorInfo?.raw) data["error_raw"] = errorInfo.raw.slice(0, 10_000);
  }

  try {
    const { error } = await db.from("prompt_executions").update(data).eq("id", executionId);
    if (error !== null && error !== undefined) {
      console.error(
        `[Orchestrator] updatePromptExecution(${executionId}, ${status}) error:`,
        error,
      );
    }
  } catch (err) {
    console.error(`[Orchestrator] updatePromptExecution(${executionId}, ${status}) threw:`, err);
  }
}

/**
 * Inserts a `prompt_executions` row with `status='skipped'` for a prompt
 * bypassed during a resume operation. Best-effort — errors are logged but
 * never thrown so they don't interrupt the run.
 */
export async function markPromptSkipped(
  db: DbClient,
  runId: string,
  promptId: string,
  reason: string,
): Promise<void> {
  try {
    const { error } = await db.from("prompt_executions").insert({
      run_id: runId,
      prompt_id: promptId,
      attempt: 0,
      status: "skipped",
      error_code: reason,
      started_at: isoNow(),
      finished_at: isoNow(),
    });
    if (error !== null && error !== undefined) {
      console.warn(`[Orchestrator] markPromptSkipped(${runId}, ${promptId}) error:`, error);
    }
  } catch (err) {
    console.warn(`[Orchestrator] markPromptSkipped(${runId}, ${promptId}) threw:`, err);
  }
}

/**
 * Sets `runs.last_succeeded_prompt_index` to record how far execution
 * progressed. Errors are logged but never thrown.
 */
async function updateLastSucceededIndex(db: DbClient, runId: string, index: number): Promise<void> {
  try {
    const { error } = await db
      .from("runs")
      .update({ last_succeeded_prompt_index: index })
      .eq("id", runId);
    if (error !== null && error !== undefined) {
      console.warn(`[Orchestrator] updateLastSucceededIndex(${runId}, ${index}) error:`, error);
    }
  } catch (err) {
    console.warn(`[Orchestrator] updateLastSucceededIndex(${runId}, ${index}) threw:`, err);
  }
}

/**
 * Clears `resume_from_index` and `resume_session_id` on the run row once
 * they've been consumed. Errors are logged but never thrown.
 */
async function clearResumeState(db: DbClient, runId: string): Promise<void> {
  try {
    const { error } = await db
      .from("runs")
      .update({ resume_from_index: null, resume_session_id: null })
      .eq("id", runId);
    if (error !== null && error !== undefined) {
      console.warn(`[Orchestrator] clearResumeState(${runId}) error:`, error);
    }
  } catch (err) {
    console.warn(`[Orchestrator] clearResumeState(${runId}) threw:`, err);
  }
}

/**
 * Sets `prompt_executions.checkpoint_sha` on a successful row. Used by the
 * orchestrator to patch every prompt in a parallel wave with the wave's single
 * commit sha after the wave-level checkpoint commit. Errors are logged but
 * never thrown.
 */
async function setCheckpointShaOnExecution(
  db: DbClient,
  executionId: string,
  sha: string,
): Promise<void> {
  if (sha.length === 0) return;
  try {
    const { error } = await db
      .from("prompt_executions")
      .update({ checkpoint_sha: sha })
      .eq("id", executionId);
    if (error !== null && error !== undefined) {
      console.warn(`[Orchestrator] setCheckpointShaOnExecution(${executionId}) error:`, error);
    }
  } catch (err) {
    console.warn(`[Orchestrator] setCheckpointShaOnExecution(${executionId}) threw:`, err);
  }
}

/**
 * Outcome of {@link Orchestrator._executePromptCore}. Cancellation is modeled
 * as a discriminated case rather than an exception so the wave-level caller
 * can short-circuit without unwinding through try/catch.
 */
type PromptOutcome =
  | {
      kind: "succeeded";
      result: ExecutionResult;
      executionId: string;
      toolsUsed: Set<string>;
      guardianDecisions: number;
    }
  | { kind: "failed"; error: string; errorCode: string }
  | { kind: "cancelled"; reason: string };

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes a {@link Plan}'s prompts in order through the Claude CLI.
 *
 * The orchestrator owns:
 *  - Sequential prompt iteration with retry/backoff
 *  - Cooperative pause/resume/cancel via {@link PauseController}
 *  - Best-effort progress emission via {@link ProgressEmitter}
 *  - DB lifecycle for `runs` and `prompt_executions`
 *  - Optional checkpoint commit/rollback when a {@link CheckpointManager} is
 *    supplied
 */
export class Orchestrator {
  private readonly plan: Plan;
  private readonly workingDir: string;
  private readonly runId: string;
  private readonly db: DbClient;
  private readonly pauseController: PauseController;
  private readonly onEvent?: (event: RunEvent) => void;
  private readonly guardian?: GuardianRunner;
  private readonly checkpoint?: CheckpointManager;
  private readonly emitter: ProgressEmitter;
  private readonly skipped = new Map<string, string>();
  private readonly alreadyDonePromptIds: ReadonlySet<string>;
  private readonly parallelConcurrencyCap: number;
  private readonly parallelStaggerMaxMs: number;
  private readonly parallelIdleTimeoutMs: number;

  constructor(opts: OrchestratorOptions) {
    this.plan = opts.plan;
    this.workingDir = opts.workingDir;
    this.runId = opts.runId;
    this.db = opts.db;
    this.pauseController = opts.pauseController;
    if (opts.onEvent) this.onEvent = opts.onEvent;
    if (opts.guardian) this.guardian = opts.guardian;
    if (opts.checkpoint) this.checkpoint = opts.checkpoint;
    this.alreadyDonePromptIds = opts.alreadyDonePromptIds ?? new Set();
    this.parallelConcurrencyCap = opts.parallelConcurrencyCap ?? PARALLEL_CONCURRENCY_CAP;
    this.parallelStaggerMaxMs = opts.parallelStaggerMaxMs ?? PARALLEL_STAGGER_MAX_MS;
    this.parallelIdleTimeoutMs = opts.parallelIdleTimeoutMs ?? PARALLEL_IDLE_TIMEOUT_MS;
    this.emitter = new ProgressEmitter(this.runId, this.db);
  }

  pause(): void {
    this.pauseController.pause();
  }

  resume(): void {
    this.pauseController.resume();
  }

  cancel(reason: string): void {
    this.pauseController.cancel(reason);
  }

  /**
   * Marks a prompt to be skipped on a best-effort basis. The next iteration
   * of the run loop checks this set before executing each prompt; prompts
   * already in flight are not interrupted.
   */
  skip(promptId: string, reason: string): void {
    this.skipped.set(promptId, reason);
  }

  /**
   * Emits an event through {@link ProgressEmitter} and forwards it to the
   * optional `onEvent` handler. Handler errors are swallowed so a misbehaving
   * subscriber cannot break the run.
   */
  private async emit(event: RunEvent): Promise<void> {
    await this.emitter.emit(event);
    if (this.onEvent) {
      try {
        const result = (this.onEvent as (e: RunEvent) => void | Promise<void>)(event);
        if (result instanceof Promise) {
          result.catch((err: unknown) =>
            console.error(`[Orchestrator] onEvent handler error for '${event.type}':`, err),
          );
        }
      } catch (err) {
        console.error(`[Orchestrator] onEvent handler threw for '${event.type}':`, err);
      }
    }
  }

  /**
   * Executes the plan end-to-end. Returns a {@link RunResult} describing the
   * terminal state. Never throws for expected failure modes (cancelled,
   * exhausted retries) — those are surfaced via the result status.
   */
  async run(): Promise<RunResult> {
    const startTime = Date.now();
    const sortedPrompts = [...this.plan.prompts].sort((a, b) => a.order - b.order);

    const { data: runData } = await this.db
      .from("runs")
      .select("resume_from_index,resume_session_id")
      .eq("id", this.runId)
      .single();
    const resumeFromIndex = (runData?.["resume_from_index"] as number | null) ?? 0;
    const initialResumeSessionId = (runData?.["resume_session_id"] as string | null) ?? undefined;

    if (resumeFromIndex > 0) {
      console.info(
        `[Orchestrator] resuming run ${this.runId} from index ${resumeFromIndex} (total: ${sortedPrompts.length}, hasSessionId: ${initialResumeSessionId !== undefined})`,
      );
    }

    const context = createExecutionContext(this.runId, this.workingDir);
    if (initialResumeSessionId !== undefined) {
      context.lastSessionId = initialResumeSessionId;
    }

    await updateRunStatus(this.runId, "running", this.db);
    await this.emit({ type: "run.started", runId: this.runId });

    let lastGoodSha = "";

    const waves = groupIntoWaves(sortedPrompts);

    const cancelledResult = (): RunResult => ({
      status: "cancelled",
      totalCostUsd: context.accumulatedCostUsd,
      totalDurationMs: Date.now() - startTime,
      completedPrompts: context.currentPromptIndex,
    });

    for (const wave of waves) {
      // ── Per-prompt skip handling (resume + explicit skip) ─────────────────
      // Each prompt in the wave is checked individually. Skipped prompts are
      // removed from the active set; if everything in the wave is skipped we
      // move on to the next wave.
      const activePrompts: PromptDefinition[] = [];
      const activeIndices: number[] = [];
      for (let j = 0; j < wave.prompts.length; j++) {
        const idx = wave.startIndex + j;
        const p = wave.prompts[j];
        if (!p) continue;

        if (idx < resumeFromIndex) {
          await markPromptSkipped(this.db, this.runId, p.id, "resumed_from_index");
          console.info(`[Orchestrator] skipping prompt ${p.id} (index ${idx}) for resume`);
          context.currentPromptIndex++;
          continue;
        }
        if (this.alreadyDonePromptIds.has(p.id)) {
          await markPromptSkipped(this.db, this.runId, p.id, "already_done");
          await this.emit({
            type: "prompt.failed",
            promptId: p.id,
            error: "Skipped: already completed successfully in a previous run of this plan",
            willRetry: false,
          });
          console.info(
            `[Orchestrator] skipping prompt ${p.id} (index ${idx}) — already_done in prior run`,
          );
          context.currentPromptIndex++;
          continue;
        }
        const skipReason = this.skipped.get(p.id);
        if (skipReason !== undefined) {
          // No `prompt.skipped` variant in RunEvent yet; we surface it as a
          // `prompt.failed` with willRetry=false (closest existing shape).
          await this.emit({
            type: "prompt.failed",
            promptId: p.id,
            error: `Skipped: ${skipReason}`,
            willRetry: false,
          });
          this.skipped.delete(p.id);
          context.currentPromptIndex++;
          continue;
        }
        activePrompts.push(p);
        activeIndices.push(idx);
      }
      if (activePrompts.length === 0) continue;

      // ── Pause / cancel BEFORE the wave ────────────────────────────────────
      const wasPaused = this.pauseController.isPaused();
      if (wasPaused) {
        await updateRunStatus(this.runId, "paused", this.db);
        await this.emit({ type: "run.paused", reason: "Paused by user" });
      }
      try {
        await this.pauseController.waitIfPaused();
      } catch (err) {
        if (err instanceof CancelledError) {
          await updateRunStatus(this.runId, "cancelled", this.db);
          return cancelledResult();
        }
        throw err;
      }
      if (wasPaused && !this.pauseController.isCancelled() && !this.pauseController.isPaused()) {
        await updateRunStatus(this.runId, "running", this.db);
      }
      if (this.pauseController.isCancelled()) {
        await updateRunStatus(this.runId, "cancelled", this.db);
        return cancelledResult();
      }

      const isParallel = activePrompts.length > 1;

      // ── Emit prompt.started for every active prompt in the wave ───────────
      for (let j = 0; j < activePrompts.length; j++) {
        const p = activePrompts[j];
        const idx = activeIndices[j];
        if (!p || idx === undefined) continue;
        await this.emit({
          type: "prompt.started",
          promptId: p.id,
          index: idx,
          total: sortedPrompts.length,
        });
      }

      if (isParallel) {
        // Parallel waves cannot share a single sessionId across siblings —
        // surface a warning for any prompt that requested continueSession so
        // the operator notices.
        for (const p of activePrompts) {
          if (p.frontmatter.continueSession === true) {
            console.warn(
              `[Orchestrator] continueSession=true ignored for prompt ${p.id} in parallel wave ${wave.wave} (siblings cannot share a session)`,
            );
          }
        }
      }

      // ── Execute (single-prompt fast path or parallel concurrency-limited) ─
      const tasks = activePrompts.map(
        (p) => () =>
          this._executePromptCore(p, context, startTime, { ignoreContinueSession: isParallel }),
      );
      const settled = isParallel
        ? await runWithConcurrencyLimit(this.parallelConcurrencyCap, tasks)
        : await runWithConcurrencyLimit(1, tasks);

      // Normalize: rejected promises (shouldn't happen — _executePromptCore
      // never throws) are coerced to a synthetic failed outcome.
      const outcomes = settled.map((s): PromptOutcome => {
        if (s.status === "fulfilled") return s.value;
        return {
          kind: "failed",
          error: errorMessage(s.reason),
          errorCode: "UNKNOWN",
        };
      });

      // ── Cancellation: any cancelled outcome wins ──────────────────────────
      if (outcomes.some((o) => o.kind === "cancelled")) {
        await updateRunStatus(this.runId, "cancelled", this.db);
        return cancelledResult();
      }

      // ── Failure: terminate run; sibling successes already wrote their rows
      const firstFailedIdx = outcomes.findIndex((o) => o.kind === "failed");
      if (firstFailedIdx !== -1) {
        const failedPrompt = activePrompts[firstFailedIdx];
        const failedOutcome = outcomes[firstFailedIdx];
        if (!failedPrompt || !failedOutcome || failedOutcome.kind !== "failed") {
          // Defensive — should never trigger.
          await updateRunStatus(this.runId, "failed", this.db);
          await clearResumeState(this.db, this.runId);
          return {
            status: "failed",
            totalCostUsd: context.accumulatedCostUsd,
            totalDurationMs: Date.now() - startTime,
            completedPrompts: context.currentPromptIndex,
            error: "internal: failed outcome missing",
          };
        }

        if (
          failedPrompt.frontmatter.rollbackOnFail === true &&
          this.checkpoint &&
          lastGoodSha.length > 0
        ) {
          try {
            await this.checkpoint.rollback(lastGoodSha);
          } catch (rollbackErr) {
            console.error("[Orchestrator] rollback failed:", rollbackErr);
          }
        }

        await updateRunStatus(this.runId, "failed", this.db);
        await clearResumeState(this.db, this.runId);
        await this.emit({
          type: "run.failed",
          failedAtPromptId: failedPrompt.id,
          error: failedOutcome.error,
        });
        return {
          status: "failed",
          totalCostUsd: context.accumulatedCostUsd,
          totalDurationMs: Date.now() - startTime,
          completedPrompts: context.currentPromptIndex,
          failedPromptId: failedPrompt.id,
          error: failedOutcome.error,
        };
      }

      // ── All prompts in this wave succeeded ────────────────────────────────
      // Cast: we've ruled out failed/cancelled above.
      const successes = outcomes as Array<Extract<PromptOutcome, { kind: "succeeded" }>>;

      // Feed execution metadata for each prompt before committing the (single)
      // checkpoint. Best-effort — failures here must not block commit.
      let sha = "";
      if (this.checkpoint) {
        if (typeof this.checkpoint.setExecutionMeta === "function") {
          for (let j = 0; j < activePrompts.length; j++) {
            const p = activePrompts[j];
            const o = successes[j];
            if (!p || !o) continue;
            try {
              const usage = mapTokenUsage(o.result.usage);
              this.checkpoint.setExecutionMeta(p.id, {
                tokensIn: usage.input,
                tokensOut: usage.output,
                tokensCache: usage.cacheRead + usage.cacheCreation,
                costUsd: o.result.costUsd,
                durationMs: o.result.durationMs,
                toolsUsed: Array.from(o.toolsUsed),
                guardianDecisions: o.guardianDecisions,
              });
            } catch (metaErr) {
              console.error(
                `[Orchestrator] checkpoint.setExecutionMeta failed for prompt ${p.id}:`,
                metaErr,
              );
            }
          }
        }
        // For parallel waves, attribute the single commit to the FIRST prompt
        // of the wave (its id makes the commit message stable in git log).
        const headPrompt = activePrompts[0];
        const headSuccess = successes[0];
        if (headPrompt && headSuccess) {
          try {
            sha = await this.checkpoint.commit(headPrompt.id, headSuccess.executionId);
            lastGoodSha = sha;
            await this.emit({
              type: "prompt.checkpoint_created",
              promptId: headPrompt.id,
              sha,
            });
          } catch (err) {
            console.error(
              `[Orchestrator] checkpoint.commit failed for wave starting at ${headPrompt.id}:`,
              err,
            );
          }
        }
      }

      // Patch every successful prompt_executions row with the wave's sha
      // (so resume/inspection can locate the commit per prompt).
      if (sha.length > 0) {
        for (const o of successes) {
          await setCheckpointShaOnExecution(this.db, o.executionId, sha);
        }
      }

      // Bookkeeping: advance to the LAST index of the wave, emit completed
      // events in original order, and bump currentPromptIndex by N.
      const lastIdx = activeIndices[activeIndices.length - 1];
      if (typeof lastIdx === "number") {
        await updateLastSucceededIndex(this.db, this.runId, lastIdx);
      }
      for (let j = 0; j < activePrompts.length; j++) {
        const p = activePrompts[j];
        const o = successes[j];
        if (!p || !o) continue;
        await this.emit({
          type: "prompt.completed",
          promptId: p.id,
          tokens: mapTokenUsage(o.result.usage),
          costUsd: o.result.costUsd,
        });
        context.currentPromptIndex++;
      }
    }

    // All waves completed.
    const totalDurationMs = Date.now() - startTime;
    await updateRunStatus(this.runId, "completed", this.db);
    await clearResumeState(this.db, this.runId);
    await this.emit({
      type: "run.completed",
      totalCostUsd: context.accumulatedCostUsd,
      durationMs: totalDurationMs,
    });
    return {
      status: "completed",
      totalCostUsd: context.accumulatedCostUsd,
      totalDurationMs,
      completedPrompts: sortedPrompts.length,
    };
  }

  /**
   * Executes a single prompt end-to-end including retry/backoff and the
   * Guardian intervention loop. Owns:
   *   - `prompt_executions` row creation/update for every attempt
   *   - usage accumulation in {@link ExecutionContext}
   *   - cancel detection (returns `{ kind: "cancelled" }` instead of throwing)
   *   - emitting `prompt.tool_use` / `prompt.tool_result` /
   *     `prompt.guardian_intervention` / `prompt.rate_limited` /
   *     `prompt.failed` events
   *
   * Does NOT own:
   *   - `prompt.started` / `prompt.completed` emission (caller's job)
   *   - Checkpoint commit (caller wraps the wave in a single commit)
   *   - `runs.last_succeeded_prompt_index` / `currentPromptIndex` bookkeeping
   *   - `prompt_executions.checkpoint_sha` patching (caller does it after the
   *     wave's checkpoint commit, so all sibling rows share the wave's sha)
   *
   * On success, the row is updated with `status='succeeded'` and an empty
   * `checkpoint_sha`; the caller patches it afterwards via
   * {@link setCheckpointShaOnExecution}.
   *
   * @param opts.ignoreContinueSession - When true, strip any inherited
   *   `resumeSessionId` before spawning Claude. Used for parallel waves
   *   where siblings cannot share a session id.
   */
  private async _executePromptCore(
    prompt: PromptDefinition,
    context: ExecutionContext,
    _runStartTime: number,
    opts: { ignoreContinueSession: boolean },
  ): Promise<PromptOutcome> {
    const retries = prompt.frontmatter.retries ?? DEFAULT_PROMPT_RETRIES;
    const maxAttempts = Math.max(1, retries + 1);
    let attempt = 1;
    let lastError: string | undefined;
    let lastErrorCode = "UNKNOWN";

    // Parallel-wave hardening: stagger the spawn so multiple Claude CLI
    // siblings don't hit the OAuth-token refresh in the same millisecond.
    // Observed on Windows that simultaneous spawns frequently hung, leaving
    // some siblings in "Esperando salida..." indefinitely. A small random
    // jitter eliminates that race on attempt 1; on retries the existing
    // backoff already provides separation.
    if (opts.ignoreContinueSession && attempt === 1 && this.parallelStaggerMaxMs > 0) {
      const jitter = Math.floor(Math.random() * this.parallelStaggerMaxMs);
      if (jitter > 0) {
        await sleep(jitter, this.pauseController.getSignal()).catch(() => {});
        if (this.pauseController.isCancelled()) {
          return { kind: "cancelled", reason: this.pauseController.getCancelReason() };
        }
      }
    }

    while (attempt <= maxAttempts) {
      let executionId: string;
      try {
        executionId = await createPromptExecution(prompt, attempt, this.runId, this.db);
      } catch (err) {
        // DB insert failures are infra-level, not Claude-level — always treat
        // as transient with default backoff.
        lastError = errorMessage(err);
        lastErrorCode = "DB_INSERT";
        const willRetry = attempt < maxAttempts;
        await this.emit({
          type: "prompt.failed",
          promptId: prompt.id,
          error: lastError,
          willRetry,
        });
        if (willRetry) {
          await sleep(
            nextDelay(DEFAULT_RETRY_POLICY, attempt),
            this.pauseController.getSignal(),
          ).catch(() => {});
          if (this.pauseController.isCancelled()) {
            return { kind: "cancelled", reason: this.pauseController.getCancelReason() };
          }
          attempt++;
          continue;
        }
        break;
      }

      const heartbeat = startPromptHeartbeat(this.db, executionId);
      try {
        try {
          let guardianInterventionCount = 0;
          let nextPromptText: string | null = null;
          let nextResumeSessionId: string | null = null;
          let result: ExecutionResult;
          const toolsUsedThisPrompt = new Set<string>();

          // eslint-disable-next-line no-constant-condition
          while (true) {
            const baseOpts = buildClaudeOptions(prompt, context);
            const claudeOpts: ClaudeProcessOptions = { ...baseOpts };
            if (opts.ignoreContinueSession) {
              // Parallel siblings cannot share a session — strip any inherited
              // resume id so each prompt starts fresh.
              claudeOpts.resumeSessionId = undefined;
              // Tighter idle timeout for parallel siblings so a stuck process
              // (e.g. OAuth/stdin contention on Windows) fails its attempt
              // quickly and the retry can recover, rather than burning the
              // run's wall-clock budget. Honors a lower per-prompt override.
              const explicit = prompt.frontmatter.idleTimeoutMs;
              if (
                this.parallelIdleTimeoutMs > 0 &&
                (typeof explicit !== "number" || explicit > this.parallelIdleTimeoutMs)
              ) {
                claudeOpts.idleTimeoutMs = this.parallelIdleTimeoutMs;
              }
            }

            if (nextPromptText !== null) {
              // Guardian feeding a follow-up answer back into the same session.
              claudeOpts.prompt = nextPromptText;
              if (nextResumeSessionId !== null && nextResumeSessionId.length > 0) {
                claudeOpts.resumeSessionId = nextResumeSessionId;
              }
            } else if (this.guardian) {
              const injection = this.guardian.getInjector().inject(claudeOpts.prompt);
              claudeOpts.prompt = injection.prompt;
            }

            claudeOpts.onActivity = () => {
              heartbeat.notifyActivity();
            };
            const proc = new ClaudeProcess(claudeOpts, buildEnv());
            await proc.start();

            const pauseController = this.pauseController;
            const cancelPromise = new Promise<never>((_resolve, reject) => {
              const checkCancel = setInterval(() => {
                if (pauseController.isCancelled()) {
                  clearInterval(checkCancel);
                  void proc.kill("user cancelled");
                  reject(new CancelledError(pauseController.getCancelReason()));
                }
              }, 500);
              proc
                .wait()
                .finally(() => clearInterval(checkCancel))
                .catch(() => undefined);
            });

            try {
              result = await Promise.race([proc.wait(), cancelPromise]);
            } catch (raceErr) {
              if (raceErr instanceof CancelledError) {
                await updatePromptExecution(executionId, "failed", null, "", this.db, {
                  code: "CANCELLED",
                  message: raceErr.message,
                });
                return { kind: "cancelled", reason: raceErr.message };
              }
              throw raceErr;
            }

            for (const event of result.capturedEvents) {
              if (event.type === "tool_use") {
                toolsUsedThisPrompt.add(event.name);
                await this.emit({
                  type: "prompt.tool_use",
                  promptId: prompt.id,
                  tool: event.name,
                  input: event.input,
                });
              } else if (event.type === "tool_result") {
                await this.emit({
                  type: "prompt.tool_result",
                  promptId: prompt.id,
                  tool: event.tool_use_id,
                  output: event.content,
                });
              }
            }

            if (result.finalStatus !== "success") {
              const procErrMsg =
                result.errorMessage ?? `Claude process ended with status: ${result.finalStatus}`;
              const err = new Error(procErrMsg);
              (err as Error & { stderrRaw?: string; stdoutRaw?: string }).stderrRaw =
                result.stderrRaw;
              (err as Error & { stdoutRaw?: string }).stdoutRaw = result.stdoutRaw;
              throw err;
            }

            addUsage(context, mapTokenUsage(result.usage), result.costUsd);

            if (this.guardian) {
              const { text: lastAssistantMessage, hasToolUse } = extractLastAssistantText(result);
              const recentMessages = extractRecentAssistantTexts(result.capturedEvents, 3);
              const promptContext = buildPromptContext(prompt);

              const intervention = await this.guardian.checkAndDecide({
                lastAssistantMessage,
                hasToolUse,
                promptContext,
                recentMessages,
                currentInterventionCount: guardianInterventionCount,
              });

              if (intervention.loopLimitReached) {
                throw new GuardianLoopError("Guardian exceeded maximum interventions");
              }

              if (intervention.intervened && intervention.guardianResponse) {
                const decision = intervention.decision;
                const detection = intervention.detectionResult;
                if (decision && detection) {
                  const guardianDecision: GuardianDecision = {
                    id: `${executionId}:gi:${intervention.interventionCount}`,
                    promptExecutionId: executionId,
                    questionDetected: detection.extractedQuestion ?? lastAssistantMessage,
                    reasoning: decision.reasoning,
                    decision: decision.decision,
                    confidence: decision.confidence,
                    strategy: decision.strategy === "llm" ? "llm" : "heuristic",
                    decidedAt: isoNow(),
                  };
                  await this.emit({
                    type: "prompt.guardian_intervention",
                    decision: guardianDecision,
                  });
                }

                if (result.sessionId.length > 0) {
                  context.lastSessionId = result.sessionId;
                }

                guardianInterventionCount = intervention.interventionCount;
                nextPromptText = intervention.guardianResponse;
                nextResumeSessionId = result.sessionId;
                continue;
              }
            }

            // No intervention required — the prompt is done.
            break;
          }

          // ── Successful prompt completion ────────────────────────────────
          // Write the row with empty sha — the caller patches it after the
          // wave-level checkpoint commit so all sibling rows share one sha.
          await updatePromptExecution(executionId, "succeeded", result, "", this.db);

          if (result.sessionId.length > 0) {
            // Parallel: last writer wins (acceptable per design — siblings
            // cannot meaningfully share continueSession anyway).
            context.lastSessionId = result.sessionId;
          }

          return {
            kind: "succeeded",
            result,
            executionId,
            toolsUsed: toolsUsedThisPrompt,
            guardianDecisions: guardianInterventionCount,
          };
        } catch (err) {
          lastError = errorMessage(err);
          const decision = classifyRetry(err, attempt);
          const isGuardianLoop = err instanceof GuardianLoopError;
          const executorErrCode = err instanceof ExecutorError ? err.code : null;
          const errCode = buildErrorCode({
            isGuardianLoop,
            classified: decision.classified,
            executorErrCode,
          });
          lastErrorCode = errCode;

          const errWithRaw = err as Error & { stderrRaw?: string; stdoutRaw?: string };
          const rawDiag = errWithRaw.stderrRaw || errWithRaw.stdoutRaw;
          await updatePromptExecution(executionId, "failed", null, "", this.db, {
            code: errCode,
            message: lastError,
            raw: rawDiag,
          });

          const willRetry = decision.retry && attempt < maxAttempts;

          if (decision.classified?.category === "rate_limit") {
            await this.emit({
              type: "prompt.rate_limited",
              promptId: prompt.id,
              waitMs: decision.waitMs,
              attempt,
            });
          }

          await this.emit({
            type: "prompt.failed",
            promptId: prompt.id,
            error: lastError,
            willRetry,
          });

          if (willRetry) {
            await sleep(decision.waitMs, this.pauseController.getSignal()).catch(() => {});
            if (this.pauseController.isCancelled()) {
              return { kind: "cancelled", reason: this.pauseController.getCancelReason() };
            }
            attempt++;
            continue;
          }
          break;
        }
      } finally {
        heartbeat.stop();
      }
    }

    return {
      kind: "failed",
      error: lastError ?? "unknown error",
      errorCode: lastErrorCode,
    };
  }
}

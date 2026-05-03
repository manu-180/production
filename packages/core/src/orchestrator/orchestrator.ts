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
  isAssistantEvent,
} from "../executor/index.js";
import type { ClaudeStreamEvent, TokenUsage as ExecutorTokenUsage } from "../executor/index.js";
import type { GuardianRunner } from "../guardian/guardian-runner.js";
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
    permissionMode: fm.permissionMode ?? "default",
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

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
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
 * Inserts a `prompt_executions` row in `running` state and returns its id.
 * Throws if the row could not be created — without an executionId we cannot
 * later record the outcome.
 */
export async function createPromptExecution(
  prompt: PromptDefinition,
  attempt: number,
  runId: string,
  db: DbClient,
): Promise<string> {
  const row: Record<string, unknown> = {
    run_id: runId,
    prompt_id: prompt.id,
    attempt,
    status: "running",
    started_at: isoNow(),
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

  constructor(opts: OrchestratorOptions) {
    this.plan = opts.plan;
    this.workingDir = opts.workingDir;
    this.runId = opts.runId;
    this.db = opts.db;
    this.pauseController = opts.pauseController;
    if (opts.onEvent) this.onEvent = opts.onEvent;
    if (opts.guardian) this.guardian = opts.guardian;
    if (opts.checkpoint) this.checkpoint = opts.checkpoint;
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
    const context = createExecutionContext(this.runId, this.workingDir);
    const sortedPrompts = [...this.plan.prompts].sort((a, b) => a.order - b.order);

    await updateRunStatus(this.runId, "running", this.db);
    await this.emit({ type: "run.started", runId: this.runId });

    let lastGoodSha = "";

    for (let i = 0; i < sortedPrompts.length; i++) {
      const prompt = sortedPrompts[i];
      if (!prompt) continue;

      // Honor skip requests before doing any work for this prompt.
      // No `prompt.skipped` variant exists in RunEvent yet, so we emit
      // `prompt.failed` with `willRetry: false` as the closest approximation
      // and remove the consumed entry so a later re-run won't auto-skip.
      const skipReason = this.skipped.get(prompt.id);
      if (skipReason !== undefined) {
        await this.emit({
          type: "prompt.failed",
          promptId: prompt.id,
          error: `Skipped: ${skipReason}`,
          willRetry: false,
        });
        this.skipped.delete(prompt.id);
        context.currentPromptIndex++;
        continue;
      }

      // Check pause/cancel BEFORE each prompt. If paused, persist the
      // 'paused' state to the DB so external observers see the run is
      // paused, then restore 'running' once we resume.
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
          return {
            status: "cancelled",
            totalCostUsd: context.accumulatedCostUsd,
            totalDurationMs: Date.now() - startTime,
            completedPrompts: context.currentPromptIndex,
          };
        }
        throw err;
      }
      if (wasPaused && !this.pauseController.isCancelled() && !this.pauseController.isPaused()) {
        await updateRunStatus(this.runId, "running", this.db);
      }

      if (this.pauseController.isCancelled()) {
        await updateRunStatus(this.runId, "cancelled", this.db);
        return {
          status: "cancelled",
          totalCostUsd: context.accumulatedCostUsd,
          totalDurationMs: Date.now() - startTime,
          completedPrompts: context.currentPromptIndex,
        };
      }

      await this.emit({
        type: "prompt.started",
        promptId: prompt.id,
        index: context.currentPromptIndex,
        total: sortedPrompts.length,
      });

      const maxAttempts = (prompt.frontmatter.retries ?? 0) + 1;
      let attempt = 1;
      let lastError: string | undefined;
      let succeeded = false;

      while (attempt <= maxAttempts) {
        let executionId: string;
        try {
          executionId = await createPromptExecution(prompt, attempt, this.runId, this.db);
        } catch (err) {
          // DB insert failures are infra-level, not Claude-level. Always treat
          // as transient and use the default backoff policy.
          lastError = errorMessage(err);
          const willRetry = attempt < maxAttempts;
          await this.emit({
            type: "prompt.failed",
            promptId: prompt.id,
            error: lastError,
            willRetry,
          });
          if (willRetry) {
            await sleep(nextDelay(DEFAULT_RETRY_POLICY, attempt));
            attempt++;
            continue;
          }
          break;
        }

        try {
          // Guardian intervention loop. Every iteration spawns a Claude
          // process and waits for it. On success, the Guardian (if
          // configured) inspects the last assistant message; when it detects
          // a question it returns a `guardianResponse` we resume the session
          // with as the next prompt. The loop ends when either Guardian
          // declines to intervene (success path) or it hits the intervention
          // ceiling (terminal `GUARDIAN_LOOP` failure).
          let guardianInterventionCount = 0;
          let nextPromptText: string | null = null;
          let nextResumeSessionId: string | null = null;
          let result: ExecutionResult;
          const toolsUsedThisPrompt = new Set<string>();

          // eslint-disable-next-line no-constant-condition
          while (true) {
            const baseOpts = buildClaudeOptions(prompt, context);
            const claudeOpts: ClaudeProcessOptions = { ...baseOpts };

            if (nextPromptText !== null) {
              // Guardian is feeding a follow-up answer back into the same
              // session — override prompt + resumeSessionId regardless of
              // what `buildClaudeOptions` produced.
              claudeOpts.prompt = nextPromptText;
              if (nextResumeSessionId !== null && nextResumeSessionId.length > 0) {
                claudeOpts.resumeSessionId = nextResumeSessionId;
              }
            } else if (this.guardian) {
              // First iteration of this attempt — inject Guardian guidelines
              // into the prompt body so Claude has the rules from the start.
              const injection = this.guardian.getInjector().inject(claudeOpts.prompt);
              claudeOpts.prompt = injection.prompt;
            }

            const proc = new ClaudeProcess(claudeOpts, buildEnv());
            await proc.start();

            // Race the process against the pause controller's cancel flag.
            // If the user cancels mid-execution, we kill the spawned Claude
            // process instead of waiting for the next prompt boundary.
            const pauseController = this.pauseController;
            const cancelPromise = new Promise<never>((_resolve, reject) => {
              const checkCancel = setInterval(() => {
                if (pauseController.isCancelled()) {
                  clearInterval(checkCancel);
                  void proc.kill("user cancelled");
                  reject(new CancelledError(pauseController.getCancelReason()));
                }
              }, 500);
              void proc.wait().finally(() => clearInterval(checkCancel));
            });

            try {
              result = await Promise.race([proc.wait(), cancelPromise]);
            } catch (raceErr) {
              if (raceErr instanceof CancelledError) {
                await updatePromptExecution(executionId, "failed", null, "", this.db, {
                  code: "CANCELLED",
                  message: raceErr.message,
                });
                await updateRunStatus(this.runId, "cancelled", this.db);
                return {
                  status: "cancelled",
                  totalCostUsd: context.accumulatedCostUsd,
                  totalDurationMs: Date.now() - startTime,
                  completedPrompts: context.currentPromptIndex,
                };
              }
              throw raceErr;
            }

            // Stream tool_use / tool_result events to the progress emitter.
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
              // Non-success terminal status from the Claude process. Bubble
              // up to the outer `catch` so retry/backoff kicks in.
              const procErrMsg =
                result.errorMessage ?? `Claude process ended with status: ${result.finalStatus}`;
              const err = new Error(procErrMsg);
              (err as Error & { stderrRaw?: string; stdoutRaw?: string }).stderrRaw =
                result.stderrRaw;
              (err as Error & { stdoutRaw?: string }).stdoutRaw = result.stdoutRaw;
              throw err;
            }

            // Always accumulate usage for completed turns — even mid-Guardian
            // iterations spent real tokens.
            addUsage(context, mapTokenUsage(result.usage), result.costUsd);

            // Guardian wiring: inspect the last assistant message and decide
            // whether to feed a follow-up back into the same session.
            if (this.guardian) {
              const { text: lastAssistantMessage, hasToolUse } = extractLastAssistantText(result);
              const recentMessages = extractRecentAssistantTexts(result.capturedEvents, 3);
              const promptContext = buildPromptContext(prompt);

              // Note: the executor does not surface a top-level `stopReason`,
              // so we omit it here. The detector falls back to other signals
              // (heuristics on the message text + `hasToolUse`) when stopReason
              // is missing.
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

                // Update lastSessionId so any later prompt that resumes this
                // session does so from the most recent turn.
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

          // ── Successful prompt completion ──────────────────────────────
          let sha = "";
          if (this.checkpoint) {
            // Feed execution metadata to the checkpoint manager (if it supports
            // it) so commit messages can include per-prompt stats. Best-effort
            // — failures here must not block commit.
            if (typeof this.checkpoint.setExecutionMeta === "function") {
              try {
                const usage = mapTokenUsage(result.usage);
                this.checkpoint.setExecutionMeta(prompt.id, {
                  tokensIn: usage.input,
                  tokensOut: usage.output,
                  tokensCache: usage.cacheRead + usage.cacheCreation,
                  costUsd: result.costUsd,
                  durationMs: result.durationMs,
                  toolsUsed: Array.from(toolsUsedThisPrompt),
                  guardianDecisions: guardianInterventionCount,
                });
              } catch (metaErr) {
                console.error(
                  `[Orchestrator] checkpoint.setExecutionMeta failed for prompt ${prompt.id}:`,
                  metaErr,
                );
              }
            }
            try {
              sha = await this.checkpoint.commit(prompt.id, executionId);
              lastGoodSha = sha;
              await this.emit({
                type: "prompt.checkpoint_created",
                promptId: prompt.id,
                sha,
              });
            } catch (err) {
              console.error(
                `[Orchestrator] checkpoint.commit failed for prompt ${prompt.id}:`,
                err,
              );
            }
          }

          await updatePromptExecution(executionId, "succeeded", result, sha, this.db);

          if (result.sessionId.length > 0) {
            context.lastSessionId = result.sessionId;
          }

          await this.emit({
            type: "prompt.completed",
            promptId: prompt.id,
            tokens: mapTokenUsage(result.usage),
            costUsd: result.costUsd,
          });

          context.currentPromptIndex++;
          succeeded = true;
          break;
        } catch (err) {
          lastError = errorMessage(err);
          // Recovery-aware classification: GuardianLoopError + non-retryable
          // ExecutorError categories (auth/config/system) break out
          // immediately. Rate-limited errors carry a `Retry-After`-derived
          // wait. Anything else uses the default exponential-jitter backoff.
          const decision = classifyRetry(err, attempt);
          const isGuardianLoop = err instanceof GuardianLoopError;
          const errCode = isGuardianLoop
            ? "GUARDIAN_LOOP"
            : decision.classified !== null
              ? decision.classified.category.toUpperCase()
              : "UNKNOWN";

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
            await sleep(decision.waitMs);
            attempt++;
            continue;
          }
          break;
        }
      }

      if (succeeded) continue;

      // Exhausted retries — terminal failure for this run.
      if (prompt.frontmatter.rollbackOnFail === true && this.checkpoint && lastGoodSha.length > 0) {
        try {
          await this.checkpoint.rollback(lastGoodSha);
        } catch (rollbackErr) {
          console.error("[Orchestrator] rollback failed:", rollbackErr);
        }
      }

      await updateRunStatus(this.runId, "failed", this.db);
      const finalError = lastError ?? "unknown error";
      await this.emit({
        type: "run.failed",
        failedAtPromptId: prompt.id,
        error: finalError,
      });
      return {
        status: "failed",
        totalCostUsd: context.accumulatedCostUsd,
        totalDurationMs: Date.now() - startTime,
        completedPrompts: context.currentPromptIndex,
        failedPromptId: prompt.id,
        error: finalError,
      };
    }

    // All prompts completed.
    const totalDurationMs = Date.now() - startTime;
    await updateRunStatus(this.runId, "completed", this.db);
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
}

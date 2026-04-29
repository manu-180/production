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
} from "../executor/index.js";
import type { TokenUsage as ExecutorTokenUsage } from "../executor/index.js";
import type { Plan, PromptDefinition, RunEvent, TokenUsage } from "../types.js";
import { type ExecutionContext, addUsage, createExecutionContext } from "./execution-context.js";
import { CancelledError, type PauseController } from "./pause-controller.js";
import { ProgressEmitter } from "./progress-emitter.js";

// ─────────────────────────────────────────────────────────────────────────────
// Phase-stub interfaces (Guardian: phase 07, CheckpointManager: phase 08)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Placeholder Guardian interface — accepted by the orchestrator but not yet
 * invoked. The full surface lands in phase 07.
 */
export interface Guardian {
  readonly name: string;
}

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
  /** Stub — held but not invoked in this phase. */
  guardian?: Guardian;
  /** Optional checkpoint manager (phase 08+). */
  checkpoint?: CheckpointManager;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

const MAX_BACKOFF_MS = 60_000;

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

async function backoff(attempt: number): Promise<void> {
  const delay = Math.min(2 ** attempt * 1000 + Math.random() * 1000, MAX_BACKOFF_MS);
  await new Promise<void>((resolve) => setTimeout(resolve, delay));
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
  errorInfo?: { code: string; message: string },
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
  /** Held intentionally — Guardian wiring lands in phase 07. */
  private readonly guardian?: Guardian;
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
          lastError = errorMessage(err);
          await this.emit({
            type: "prompt.failed",
            promptId: prompt.id,
            error: lastError,
            willRetry: attempt < maxAttempts,
          });
          if (attempt < maxAttempts) {
            await backoff(attempt);
            attempt++;
            continue;
          }
          break;
        }

        try {
          const claudeOpts = buildClaudeOptions(prompt, context);
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

          let result: ExecutionResult;
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

          if (result.finalStatus === "success") {
            addUsage(context, mapTokenUsage(result.usage), result.costUsd);

            let sha = "";
            if (this.checkpoint) {
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
          }

          // Non-success terminal status from the Claude process.
          const procErrMsg =
            result.errorMessage ?? `Claude process ended with status: ${result.finalStatus}`;
          throw new Error(procErrMsg);
        } catch (err) {
          lastError = errorMessage(err);
          await updatePromptExecution(executionId, "failed", null, "", this.db, {
            code: "UNKNOWN",
            message: lastError,
          });
          await this.emit({
            type: "prompt.failed",
            promptId: prompt.id,
            error: lastError,
            willRetry: attempt < maxAttempts,
          });

          if (attempt < maxAttempts) {
            await backoff(attempt);
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

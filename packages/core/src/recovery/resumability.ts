/**
 * Conductor — Resumability (Recovery)
 *
 * Helpers for marking a run as resumable, computing where to pick up from, and
 * re-queueing it via a manual user action.
 *
 * The DB shape used here is independent from the orchestrator's narrow
 * `DbClient` (which only has `eq().single()` chains). Resumability needs a
 * couple of extra filters (`order`, multi-eq), so it defines its own minimal
 * surface — kept structural so any Supabase-style client satisfies it.
 */

export interface ResumabilityLogger {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
}

export interface ResumeDbResult<T> {
  data: T | null;
  error: unknown;
}

export interface ResumeDbSelect<T> extends PromiseLike<ResumeDbResult<T>> {
  eq(col: string, val: unknown): ResumeDbSelect<T>;
  order(col: string, opts?: { ascending?: boolean }): ResumeDbSelect<T>;
  single(): PromiseLike<ResumeDbResult<T>>;
}

export interface ResumeDbUpdate extends PromiseLike<ResumeDbResult<unknown>> {
  eq(col: string, val: unknown): ResumeDbUpdate;
}

export interface ResumeDbTable {
  select(cols?: string): ResumeDbSelect<unknown>;
  update(data: Record<string, unknown>): ResumeDbUpdate;
}

export interface ResumeDbClient {
  from(table: string): ResumeDbTable;
}

export interface ResumableRun {
  id: string;
  status: string;
  current_prompt_index?: number | null;
  cancellation_reason?: string | null;
  plan_id?: string;
  working_dir?: string;
  checkpoint_branch?: string | null;
}

export interface ResumableExecution {
  id: string;
  prompt_id: string;
  attempt: number;
  status: string;
  checkpoint_sha?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface ResumableState {
  run: ResumableRun;
  executions: ResumableExecution[];
  lastSuccessfulIndex: number;
  nextAttempt: number;
  inFlightPromptId?: string;
}

/**
 * Load the run row + all prompt_executions and compute where a resume should
 * pick up from. Returns null if the run cannot be loaded.
 */
export async function loadResumableState(
  runId: string,
  db: ResumeDbClient,
  logger?: ResumabilityLogger,
): Promise<ResumableState | null> {
  let run: ResumableRun;
  try {
    const result = await db
      .from("runs")
      .select(
        "id, status, current_prompt_index, cancellation_reason, plan_id, working_dir, checkpoint_branch",
      )
      .eq("id", runId)
      .single();
    if (result.error !== null && result.error !== undefined) {
      logger?.warn?.({ runId, err: result.error }, "[Resumability] failed to load run");
      return null;
    }
    if (result.data === null) {
      logger?.warn?.({ runId }, "[Resumability] run not found");
      return null;
    }
    run = result.data as ResumableRun;
  } catch (err) {
    logger?.error?.({ runId, err }, "[Resumability] loadResumableState threw on run");
    return null;
  }

  let executions: ResumableExecution[] = [];
  try {
    const result = await db
      .from("prompt_executions")
      .select(
        "id, prompt_id, attempt, status, checkpoint_sha, error_code, error_message, started_at, finished_at",
      )
      .eq("run_id", runId)
      .order("started_at", { ascending: true });

    if (result.error !== null && result.error !== undefined) {
      logger?.warn?.(
        { runId, err: result.error },
        "[Resumability] failed to load executions; assuming none",
      );
    } else {
      const data = result.data;
      if (Array.isArray(data)) {
        executions = data as ResumableExecution[];
      }
    }
  } catch (err) {
    logger?.error?.({ runId, err }, "[Resumability] loadResumableState threw on executions");
  }

  const latestByPrompt = new Map<
    string,
    { latestAttempt: number; succeeded: boolean; hasCheckpoint: boolean; running: boolean }
  >();
  for (const ex of executions) {
    if (typeof ex.prompt_id !== "string") continue;
    const prev = latestByPrompt.get(ex.prompt_id);
    const attempt = typeof ex.attempt === "number" ? ex.attempt : 1;
    const succeeded = ex.status === "succeeded";
    const hasCheckpoint = typeof ex.checkpoint_sha === "string" && ex.checkpoint_sha.length > 0;
    const running = ex.status === "running";
    if (prev === undefined) {
      latestByPrompt.set(ex.prompt_id, {
        latestAttempt: attempt,
        succeeded,
        hasCheckpoint,
        running,
      });
    } else {
      latestByPrompt.set(ex.prompt_id, {
        latestAttempt: Math.max(prev.latestAttempt, attempt),
        succeeded: prev.succeeded || succeeded,
        hasCheckpoint: prev.hasCheckpoint || hasCheckpoint,
        running: prev.running || running,
      });
    }
  }

  let succeededCount = 0;
  for (const summary of latestByPrompt.values()) {
    if (summary.succeeded) succeededCount += 1;
  }
  const lastSuccessfulIndex = succeededCount > 0 ? succeededCount - 1 : -1;

  let inFlightPromptId: string | undefined;
  let nextAttempt = 1;
  for (const [promptId, summary] of latestByPrompt) {
    if (!summary.succeeded) {
      inFlightPromptId = promptId;
      nextAttempt = summary.latestAttempt + 1;
      break;
    }
  }

  const state: ResumableState = {
    run,
    executions,
    lastSuccessfulIndex,
    nextAttempt,
  };
  if (inFlightPromptId !== undefined) {
    state.inFlightPromptId = inFlightPromptId;
  }
  return state;
}

/**
 * Mark a run as resumable (status='paused' + cancellation_reason).
 * Idempotent: succeeds even if the row is already paused.
 */
export async function markRunResumable(
  runId: string,
  db: ResumeDbClient,
  reason: string,
  logger?: ResumabilityLogger,
): Promise<boolean> {
  try {
    const { error } = await db
      .from("runs")
      .update({ status: "paused", cancellation_reason: reason })
      .eq("id", runId);
    if (error !== null && error !== undefined) {
      logger?.warn?.({ runId, err: error }, "[Resumability] markRunResumable failed");
      return false;
    }
    return true;
  } catch (err) {
    logger?.error?.({ runId, err }, "[Resumability] markRunResumable threw");
    return false;
  }
}

/**
 * Re-queue a paused run. Idempotent: only flips when the run is currently
 * `paused`. If it's already queued/running/completed, this is a no-op.
 */
export async function resumeRun(
  runId: string,
  db: ResumeDbClient,
  logger?: ResumabilityLogger,
): Promise<boolean> {
  try {
    const { error } = await db
      .from("runs")
      .update({ status: "queued", cancellation_reason: null, last_heartbeat_at: null })
      .eq("id", runId)
      .eq("status", "paused");
    if (error !== null && error !== undefined) {
      logger?.warn?.({ runId, err: error }, "[Resumability] resumeRun failed");
      return false;
    }
    return true;
  } catch (err) {
    logger?.error?.({ runId, err }, "[Resumability] resumeRun threw");
    return false;
  }
}

import type { Json, Plan, PromptExecution, Run } from "@conductor/db";

/**
 * What `/api/runs/:id` returns — Run flat-spread, plus joined executions and plan.
 * Mirror exactly so React Query's typed cache stays honest.
 *
 * NOTE: the actual DB schema uses scalar token columns
 * (input_tokens, output_tokens, cache_tokens) on both runs and prompt_executions,
 * NOT a single jsonb `tokens` blob. error info is split into error_code/error_message/error_raw.
 */
export type RunDetailCache = Run & {
  executions: (PromptExecution & {
    prompts?: { order_index: number; title: string | null; filename: string | null } | null;
  })[];
  plan: Plan | null;
  /**
   * Highest sequence applied from realtime events. Guards against double-apply
   * when RQ refetch races a live event. -1 = no events applied yet.
   */
  _lastAppliedSequence: number;
};

export interface RealtimeEvent {
  runId: string;
  sequence: number;
  eventType: string;
  payload: Json;
  promptExecutionId: string | null;
}

function readStr(p: Record<string, unknown>, key: string): string | undefined {
  const v = p[key];
  return typeof v === "string" ? v : undefined;
}
function readNum(p: Record<string, unknown>, key: string): number | undefined {
  const v = p[key];
  return typeof v === "number" ? v : undefined;
}

export function applyEvent(prev: RunDetailCache, ev: RealtimeEvent): RunDetailCache {
  if (ev.sequence <= prev._lastAppliedSequence) return prev;

  const advance = (patch: Partial<Run> = {}): RunDetailCache => ({
    ...prev,
    ...patch,
    _lastAppliedSequence: ev.sequence,
  });
  const patchExecution = (id: string, patch: Partial<PromptExecution>): RunDetailCache => ({
    ...prev,
    executions: prev.executions.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    _lastAppliedSequence: ev.sequence,
  });

  const p = (ev.payload ?? {}) as Record<string, unknown>;

  switch (ev.eventType) {
    case "run.started":
      return advance({
        status: "running",
        started_at: readStr(p, "startedAt") ?? prev.started_at,
      });
    case "run.paused":
      return advance({ status: "paused" });
    case "run.resumed":
      return advance({ status: "running" });
    case "run.cancelled":
      return advance({
        status: "cancelled",
        finished_at: readStr(p, "finishedAt") ?? prev.finished_at,
        cancellation_reason: readStr(p, "reason") ?? prev.cancellation_reason,
      });
    case "run.completed":
      return advance({
        status: "completed",
        finished_at: readStr(p, "finishedAt") ?? prev.finished_at,
        total_cost_usd: readNum(p, "totalCostUsd") ?? prev.total_cost_usd,
      });
    case "run.failed":
      return advance({
        status: "failed",
        finished_at: readStr(p, "finishedAt") ?? prev.finished_at,
      });
    case "prompt.started": {
      const id = ev.promptExecutionId;
      if (id === null) return advance();
      return patchExecution(id, {
        status: "running",
        started_at: readStr(p, "startedAt") ?? null,
      });
    }
    case "prompt.completed": {
      const id = ev.promptExecutionId;
      if (id === null) return advance();
      const existing = prev.executions.find((e) => e.id === id);
      return patchExecution(id, {
        status: "succeeded",
        finished_at: readStr(p, "finishedAt") ?? null,
        cost_usd: readNum(p, "costUsd") ?? existing?.cost_usd ?? 0,
        input_tokens: readNum(p, "inputTokens") ?? existing?.input_tokens ?? 0,
        output_tokens: readNum(p, "outputTokens") ?? existing?.output_tokens ?? 0,
        cache_tokens: readNum(p, "cacheTokens") ?? existing?.cache_tokens ?? 0,
        duration_ms: readNum(p, "durationMs") ?? existing?.duration_ms ?? null,
      });
    }
    case "prompt.failed": {
      const id = ev.promptExecutionId;
      if (id === null) return advance();
      return patchExecution(id, {
        status: "failed",
        finished_at: readStr(p, "finishedAt") ?? null,
        error_code: readStr(p, "errorCode") ?? null,
        error_message: readStr(p, "errorMessage") ?? null,
        error_raw: readStr(p, "errorRaw") ?? null,
      });
    }
    case "prompt.awaiting_approval": {
      const id = ev.promptExecutionId;
      if (id === null) return advance();
      return patchExecution(id, { status: "awaiting_approval" });
    }
    case "prompt.skipped": {
      const id = ev.promptExecutionId;
      if (id === null) return advance();
      return patchExecution(id, { status: "skipped" });
    }
    default:
      return advance(); // unknown event — advance sequence, no other patch
  }
}

/**
 * Initialize cache from API response. The API does NOT include sequence,
 * so seed _lastAppliedSequence = -1 and let realtime catch up.
 */
export function seedCache(
  apiResponse: Omit<RunDetailCache, "_lastAppliedSequence">,
): RunDetailCache {
  return { ...apiResponse, _lastAppliedSequence: -1 };
}

/**
 * Merge a `prompt_executions` row delivered via realtime into the cache.
 *
 * Used as a fallback to {@link applyEvent} because run-event payloads do not
 * carry `prompt_execution_id`, so prompt-level status updates were silently
 * dropped from the React Query cache. Subscribing directly to the table keeps
 * the UI in lockstep with DB state.
 *
 * - If the row already exists (matched by id), patch it in place — preserves
 *   any joined `prompts` metadata seeded from the initial API fetch.
 * - If new (a freshly inserted attempt), append it. The `prompts` join may be
 *   missing on realtime payloads; we copy it from a sibling execution that
 *   shares the same `prompt_id` when available so ordering still works.
 */
export function applyExecutionRow(prev: RunDetailCache, row: PromptExecution): RunDetailCache {
  const existingIdx = prev.executions.findIndex((e) => e.id === row.id);
  if (existingIdx !== -1) {
    const existing = prev.executions[existingIdx];
    if (!existing) return prev;
    const next = prev.executions.slice();
    next[existingIdx] = { ...existing, ...row, prompts: existing.prompts };
    return { ...prev, executions: next };
  }

  const sibling = prev.executions.find((e) => e.prompt_id === row.prompt_id);
  return {
    ...prev,
    executions: [...prev.executions, { ...row, prompts: sibling?.prompts ?? null }],
  };
}

/**
 * Merge a `runs` row delivered via realtime into the cache. Spreads scalar
 * columns onto the top-level Run while preserving the joined `executions` and
 * `plan` and the realtime sequence cursor.
 */
export function applyRunRow(prev: RunDetailCache, row: Partial<Run>): RunDetailCache {
  return { ...prev, ...row };
}

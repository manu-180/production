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
  const patchExecution = (
    id: string,
    patch: Partial<PromptExecution>,
  ): RunDetailCache => ({
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

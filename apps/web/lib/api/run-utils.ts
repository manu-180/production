import type { ServiceClient } from "@conductor/db";

/**
 * Insert a `run_events` row from a route. The orchestrator has its own
 * in-memory sequencer (`ProgressEmitter`) that may race with us when the API
 * emits user-driven events (pause / cancel / approve) while the worker is
 * still streaming. Both sides drive sequence forward independently — the
 * unique (run_id, sequence) constraint ensures a duplicate fails loudly
 * rather than corrupting order. We accept the rare collision: worst case the
 * losing emitter logs and moves on.
 *
 * @param db   service-role client (bypasses RLS so events from API + worker
 *             share the same identity space)
 * @param runId
 * @param eventType   stable string the UI branches on
 *                    (e.g. "user.pause", "user.resume", "user.cancel")
 * @param payload     JSON object delivered alongside the event
 * @returns the inserted sequence number, or `null` on failure
 */
export async function emitRunEvent(
  db: ServiceClient,
  runId: string,
  eventType: string,
  payload: Record<string, unknown> = {},
  promptExecutionId?: string,
): Promise<number | null> {
  const { data: seqRow, error: seqErr } = await db.rpc("next_event_sequence", {
    p_run_id: runId,
  });
  if (seqErr !== null || typeof seqRow !== "number") return null;

  const { error: insErr } = await db.from("run_events").insert({
    run_id: runId,
    sequence: seqRow,
    event_type: eventType,
    payload: payload as never,
    prompt_execution_id: promptExecutionId ?? null,
  });
  if (insErr !== null) return null;
  return seqRow;
}

/**
 * Verify a run exists and belongs to `userId`. Mirrors `assertPlanOwned`.
 * Returns the run row's status + plan_id for downstream conditional logic
 * (e.g. "only allow pause when running"), or null when not found / not owned.
 */
export async function assertRunOwned(
  db: ServiceClient,
  runId: string,
  userId: string,
): Promise<{
  id: string;
  status: string;
  plan_id: string;
  working_dir: string;
} | null> {
  const { data } = await db
    .from("runs")
    .select("id, status, plan_id, working_dir")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Conditional status transition. Updates `runs.status` only when the current
 * status is in `fromStatuses`. Returns the updated row, or null when the
 * transition didn't apply (caller maps to 409 Conflict).
 */
export async function transitionRunStatus(
  db: ServiceClient,
  runId: string,
  fromStatuses: string[],
  toStatus: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; status: string } | null> {
  const update: Record<string, unknown> = { status: toStatus, ...extra };
  const { data } = await db
    .from("runs")
    // biome-ignore lint/suspicious/noExplicitAny: structural update payload
    .update(update as any)
    .eq("id", runId)
    .in("status", fromStatuses)
    .select("id, status")
    .maybeSingle();
  return data ?? null;
}

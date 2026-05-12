import { beforeEach, describe, expect, it, vi } from "vitest";
import { reapStalePromptExecutions } from "../../startup-recovery.js";

// ---------------------------------------------------------------------------
// Supabase mock builder
// ---------------------------------------------------------------------------

function makeSupabaseMock(
  promptExecutionsResult: { data: unknown; error: unknown },
  runsResult: { data: unknown; error: unknown },
) {
  // Runs chain: .from('runs').update({status:'paused', ...}).eq('id', runId).eq('status','running')
  const runEq2 = vi.fn().mockResolvedValue(runsResult);
  const runEq1 = vi.fn().mockReturnValue({ eq: runEq2 });
  const runUpdate = vi.fn().mockReturnValue({ eq: runEq1 });

  // prompt_executions chain. When excludeRunIds is empty:
  //   .from('prompt_executions').update({...}).eq('status','running').lt('last_progress_at', cutoff).select('id, run_id')
  // When excludeRunIds is non-empty, an extra .not('run_id','in', ...) is inserted before .select().
  const peSelect = vi.fn().mockResolvedValue(promptExecutionsResult);
  const peNot = vi.fn().mockReturnValue({ select: peSelect });
  const peLt = vi.fn().mockReturnValue({ select: peSelect, not: peNot });
  const peEq = vi.fn().mockReturnValue({ lt: peLt });
  const peUpdate = vi.fn().mockReturnValue({ eq: peEq });

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === "prompt_executions") return { update: peUpdate };
    if (table === "runs") return { update: runUpdate };
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from: fromMock },
    peUpdate,
    peEq,
    peLt,
    peNot,
    peSelect,
    runUpdate,
    runEq1,
    runEq2,
  };
}

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("reapStalePromptExecutions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reaps stale executions and marks the parent run as paused (resumable)", async () => {
    const { supabase, peUpdate, runUpdate, runEq1 } = makeSupabaseMock(
      { data: [{ id: "pe-1", run_id: "r-1" }], error: null },
      { data: null, error: null },
    );

    const result = await reapStalePromptExecutions(supabase as never, mockLogger as never);

    // Should return count of reaped executions.
    expect(result).toBe(1);

    // prompt_executions.update called with correct failure fields.
    expect(peUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_code: "STALE_HEARTBEAT",
      }),
    );

    // runs.update flips the parent to `paused` with the recovery reason so
    // the user can resume the run rather than losing all progress to a
    // terminal `failed` status.
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "paused",
        cancellation_reason: "worker_crash_recovery",
        finished_at: null,
      }),
    );

    // The first .eq on the runs chain should use the stale run's id.
    expect(runEq1).toHaveBeenCalledWith("id", "r-1");
  });

  it("marks parent run as paused only once when multiple stale executions share the same run_id", async () => {
    const { supabase, runUpdate } = makeSupabaseMock(
      {
        data: [
          { id: "pe-1", run_id: "r-1" },
          { id: "pe-2", run_id: "r-1" },
        ],
        error: null,
      },
      { data: null, error: null },
    );

    const result = await reapStalePromptExecutions(supabase as never, mockLogger as never);

    // Both executions reaped.
    expect(result).toBe(2);

    // Deduplication via Set → runs.update called exactly once for r-1.
    expect(runUpdate).toHaveBeenCalledTimes(1);
    expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "paused" }));
  });

  it("filters out excluded run IDs via .not('run_id','in', ...)", async () => {
    const { supabase, peNot } = makeSupabaseMock(
      { data: [], error: null },
      { data: null, error: null },
    );

    await reapStalePromptExecutions(supabase as never, mockLogger as never, {
      excludeRunIds: new Set(["r-active-1", "r-active-2"]),
    });

    expect(peNot).toHaveBeenCalledWith("run_id", "in", "(r-active-1,r-active-2)");
  });

  it("returns 0 and logs error when the DB update fails", async () => {
    const { supabase } = makeSupabaseMock(
      { data: null, error: { message: "DB error" } },
      { data: null, error: null },
    );

    const result = await reapStalePromptExecutions(supabase as never, mockLogger as never);

    expect(result).toBe(0);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ message: "DB error" }) }),
      "startup-recovery.reap_stale.failed",
    );
  });

  it("returns 0 when there are no stale executions", async () => {
    const { supabase, runUpdate } = makeSupabaseMock(
      { data: [], error: null },
      { data: null, error: null },
    );

    const result = await reapStalePromptExecutions(supabase as never, mockLogger as never);

    expect(result).toBe(0);
    // No runs should be touched.
    expect(runUpdate).not.toHaveBeenCalled();
  });
});

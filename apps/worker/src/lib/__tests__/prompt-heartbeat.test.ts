import { startPromptHeartbeat } from "@conductor/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeMockDb() {
  const eqMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
  const fromMock = vi.fn().mockReturnValue({ update: updateMock });
  const mockDb = { from: fromMock };
  return { mockDb, fromMock, updateMock, eqMock };
}

// Hardcoded mirror of the core constants so the test pins the contract.
// If these change in src, this test breaks loudly — that's the intent.
const HEARTBEAT_INTERVAL_MS = 5_000;
const COLD_START_GRACE_MS = 60_000;

describe("startPromptHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires an immediate write at t=0 so last_progress_at is fresh from the start", async () => {
    const { mockDb, eqMock } = makeMockDb();
    const { stop } = startPromptHeartbeat(mockDb as never, "exec-1");

    // The constructor enqueues `void write()` — flush microtasks so it lands.
    await vi.advanceTimersByTimeAsync(0);
    expect(eqMock).toHaveBeenCalledTimes(1);

    stop();
  });

  it("during the cold-start grace window, every tick writes regardless of activity", async () => {
    const { mockDb, eqMock } = makeMockDb();
    const { stop } = startPromptHeartbeat(mockDb as never, "exec-1");

    // Flush the immediate write.
    await vi.advanceTimersByTimeAsync(0);
    expect(eqMock).toHaveBeenCalledTimes(1);

    // Advance through a few ticks well inside the cold-start window without
    // notifyActivity — every tick must still write so the orphan sweeper
    // doesn't reap a healthy cold-starting process.
    for (let i = 1; i <= 3; i++) {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 100);
      expect(eqMock).toHaveBeenCalledTimes(1 + i);
    }

    stop();
  });

  it("after cold-start grace expires, ticks without activity are skipped", async () => {
    const { mockDb, eqMock } = makeMockDb();
    const { stop } = startPromptHeartbeat(mockDb as never, "exec-1");

    // Skim past the cold-start window. Each tick inside the window writes
    // unconditionally — we don't pin the exact count here, just need to be
    // past the grace boundary.
    await vi.advanceTimersByTimeAsync(COLD_START_GRACE_MS + HEARTBEAT_INTERVAL_MS + 100);
    const callsAfterColdStart = eqMock.mock.calls.length;
    expect(callsAfterColdStart).toBeGreaterThan(0);

    // Now we're outside the grace window. Without notifyActivity the next
    // few ticks should NOT write — let the sweeper see this as stalled.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 3 + 100);
    expect(eqMock).toHaveBeenCalledTimes(callsAfterColdStart);

    stop();
  });

  it("after cold-start grace, notifyActivity re-enables exactly one tick write", async () => {
    const { mockDb, eqMock } = makeMockDb();
    const { notifyActivity, stop } = startPromptHeartbeat(mockDb as never, "exec-1");

    await vi.advanceTimersByTimeAsync(COLD_START_GRACE_MS + HEARTBEAT_INTERVAL_MS + 100);
    const baseline = eqMock.mock.calls.length;

    // Quiet — no writes.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2 + 100);
    expect(eqMock).toHaveBeenCalledTimes(baseline);

    // Activity → next tick writes once and the flag is consumed.
    notifyActivity();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 100);
    expect(eqMock).toHaveBeenCalledTimes(baseline + 1);

    // No further activity → next tick skips again.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 100);
    expect(eqMock).toHaveBeenCalledTimes(baseline + 1);

    stop();
  });

  it("stop() clears the interval — no further ticks fire (but the immediate write still lands)", async () => {
    const { mockDb, eqMock } = makeMockDb();
    const { stop } = startPromptHeartbeat(mockDb as never, "exec-1");

    stop();
    // The immediate write was enqueued before stop() — flush it.
    await vi.advanceTimersByTimeAsync(0);
    const baseline = eqMock.mock.calls.length;
    expect(baseline).toBeLessThanOrEqual(1);

    // No additional ticks should fire after stop, even past the cold-start grace.
    await vi.advanceTimersByTimeAsync(COLD_START_GRACE_MS + HEARTBEAT_INTERVAL_MS * 5);
    expect(eqMock).toHaveBeenCalledTimes(baseline);
  });
});

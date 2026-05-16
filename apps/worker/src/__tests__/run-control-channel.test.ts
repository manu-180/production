/**
 * Tests for RunControlChannel — the bridge between Supabase Realtime
 * `runs` UPDATE events and the in-memory orchestrator's pause/resume/cancel
 * handles.
 *
 * Strategy: mock `@supabase/supabase-js` so `createClient` returns a
 * controllable client. Capture the subscribe callback and the
 * postgres_changes handler so the test can drive transitions
 * deterministically (no real realtime connection, no timers wall-clock).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Supabase JS mock — captures channel/subscribe/postgres_changes wiring.
// ---------------------------------------------------------------------------

interface ChannelHandle {
  subscribeCallback: ((status: string) => void) | null;
  pgChangesHandler: ((msg: { new: Record<string, unknown> | null }) => void) | null;
  removed: boolean;
}

const channelHandles: ChannelHandle[] = [];
let lastSelectResult: { data: unknown; error: unknown } = {
  data: { status: "running", cancellation_reason: null },
  error: null,
};

// We use a single object as both the handle (test inspection) and the
// fluent builder returned by `.channel().on().subscribe()` so that whatever
// reference RunControlChannel ends up keeping is the same one we observe
// in the test (and the same one passed to removeChannel).
function makeChannel(): ChannelHandle {
  const handle: ChannelHandle = {
    subscribeCallback: null,
    pgChangesHandler: null,
    removed: false,
  };
  const builder = handle as ChannelHandle & {
    on: (event: string, filter: unknown, handler: (msg: unknown) => void) => unknown;
    subscribe: (cb: (status: string) => void) => unknown;
  };
  builder.on = (_event, _filter, handler) => {
    handle.pgChangesHandler = handler as ChannelHandle["pgChangesHandler"];
    return builder;
  };
  builder.subscribe = (cb) => {
    handle.subscribeCallback = cb;
    return builder;
  };
  channelHandles.push(handle);
  return builder;
}

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

function buildSupabaseClient() {
  return {
    channel: vi.fn(() => makeChannel()),
    removeChannel: vi.fn(async (h: ChannelHandle) => {
      h.removed = true;
    }),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: async () => lastSelectResult,
        }),
      }),
    })),
  };
}

// ---------------------------------------------------------------------------
// Test logger that quietly captures.
// ---------------------------------------------------------------------------

const mkLogger = () =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }) as never;

// ---------------------------------------------------------------------------

import { RunControlChannel } from "../run-control-channel.js";

describe("RunControlChannel", () => {
  let onPause: ReturnType<typeof vi.fn>;
  let onResume: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    channelHandles.length = 0;
    onPause = vi.fn();
    onResume = vi.fn();
    onCancel = vi.fn();
    lastSelectResult = {
      data: { status: "running", cancellation_reason: null },
      error: null,
    };
    createClientMock.mockReset();
    createClientMock.mockImplementation(() => buildSupabaseClient());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Get the (only) channel created by build()/start(). Throws if missing. */
  function ch0(): ChannelHandle {
    const h = channelHandles[0];
    if (h === undefined) throw new Error("no channel registered yet");
    return h;
  }

  function build(): RunControlChannel {
    return new RunControlChannel({
      runId: "run-123",
      supabaseUrl: "https://x.supabase.co",
      supabaseServiceKey: "service-key",
      logger: mkLogger(),
      onPause,
      onResume,
      onCancel,
    });
  }

  it("does not fire any callback for the initial running baseline", async () => {
    const ch = build();
    await ch.start();
    expect(channelHandles).toHaveLength(1);
    // Simulate SUBSCRIBED → triggers reconcile which reads status='running'.
    ch0().subscribeCallback?.("SUBSCRIBED");
    await flush();
    expect(onPause).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    await ch.stop();
  });

  it("fires onPause when realtime delivers running → paused", async () => {
    const ch = build();
    await ch.start();
    ch0().subscribeCallback?.("SUBSCRIBED");
    await flush();

    ch0().pgChangesHandler?.({
      new: { status: "paused", cancellation_reason: null },
    });
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    await ch.stop();
  });

  it("fires onResume only when transitioning paused → running", async () => {
    const ch = build();
    await ch.start();
    ch0().subscribeCallback?.("SUBSCRIBED");
    await flush();

    // Pause first.
    ch0().pgChangesHandler?.({
      new: { status: "paused", cancellation_reason: null },
    });
    expect(onPause).toHaveBeenCalledTimes(1);

    // Resume.
    ch0().pgChangesHandler?.({
      new: { status: "running", cancellation_reason: null },
    });
    expect(onResume).toHaveBeenCalledTimes(1);
    await ch.stop();
  });

  it("does NOT fire onResume on the first (baseline) running observation", async () => {
    const ch = build();
    await ch.start();
    // First running event after subscribe is the baseline; previous status
    // is null, so resume must not fire.
    ch0().pgChangesHandler?.({
      new: { status: "running", cancellation_reason: null },
    });
    expect(onResume).not.toHaveBeenCalled();
    await ch.stop();
  });

  it("fires onCancel with the cancellation_reason from the row", async () => {
    const ch = build();
    await ch.start();
    ch0().subscribeCallback?.("SUBSCRIBED");
    await flush();

    ch0().pgChangesHandler?.({
      new: { status: "cancelled", cancellation_reason: "user_initiated" },
    });
    expect(onCancel).toHaveBeenCalledWith("user_initiated");
    await ch.stop();
  });

  it("falls back to a default reason when cancellation_reason is null", async () => {
    const ch = build();
    await ch.start();
    ch0().pgChangesHandler?.({
      new: { status: "cancelled", cancellation_reason: null },
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel.mock.calls[0]?.[0]).toBeTruthy();
    await ch.stop();
  });

  it("ignores duplicate same-status transitions (idempotent)", async () => {
    const ch = build();
    await ch.start();
    ch0().pgChangesHandler?.({
      new: { status: "paused", cancellation_reason: null },
    });
    ch0().pgChangesHandler?.({
      new: { status: "paused", cancellation_reason: null },
    });
    ch0().pgChangesHandler?.({
      new: { status: "paused", cancellation_reason: null },
    });
    expect(onPause).toHaveBeenCalledTimes(1);
    await ch.stop();
  });

  it("ignores non-control statuses (queued/completed/failed)", async () => {
    const ch = build();
    await ch.start();
    for (const status of ["queued", "completed", "failed"]) {
      ch0().pgChangesHandler?.({
        new: { status, cancellation_reason: null },
      });
    }
    expect(onPause).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    await ch.stop();
  });

  it("reconcile picks up a missed pause that arrived before SUBSCRIBED", async () => {
    // Simulate the worker claiming a run, then the user pausing it before
    // realtime is open. handleRow via reconcile should fire onPause.
    lastSelectResult = {
      data: { status: "paused", cancellation_reason: null },
      error: null,
    };
    const ch = build();
    await ch.start();
    ch0().subscribeCallback?.("SUBSCRIBED");
    await flush();

    expect(onPause).toHaveBeenCalledTimes(1);
    await ch.stop();
  });

  it("safety-interval reconcile catches a pause if realtime is silent", async () => {
    const ch = build();
    await ch.start();
    ch0().subscribeCallback?.("SUBSCRIBED");
    await flush();

    // Realtime never delivers; DB flips to paused.
    lastSelectResult = {
      data: { status: "paused", cancellation_reason: null },
      error: null,
    };

    // Advance the 5s reconcile timer.
    await vi.advanceTimersByTimeAsync(5_001);
    expect(onPause).toHaveBeenCalledTimes(1);
    await ch.stop();
  });

  it("stop() prevents further callbacks even if realtime delivers afterwards", async () => {
    const ch = build();
    await ch.start();
    await ch.stop();

    ch0().pgChangesHandler?.({
      new: { status: "paused", cancellation_reason: null },
    });
    expect(onPause).not.toHaveBeenCalled();
  });

  it("stop() is idempotent", async () => {
    const ch = build();
    await ch.start();
    await ch.stop();
    await ch.stop();
    expect(ch0().removed).toBe(true);
  });

  it("does not throw when reconcile DB query errors", async () => {
    lastSelectResult = { data: null, error: new Error("network down") };
    const ch = build();
    await ch.start();
    ch0().subscribeCallback?.("SUBSCRIBED");
    await flush();
    // No callbacks, no throw.
    expect(onPause).not.toHaveBeenCalled();
    await ch.stop();
  });

  it("absorbs a throwing callback so the channel keeps working", async () => {
    onPause.mockImplementation(() => {
      throw new Error("orchestrator boom");
    });
    const ch = build();
    await ch.start();

    expect(() =>
      ch0().pgChangesHandler?.({
        new: { status: "paused", cancellation_reason: null },
      }),
    ).not.toThrow();
    await ch.stop();
  });
});

// Helper: drain queued microtasks. Useful after an `await flush()` in tests
// that fire async work via fire-and-forget `void` (e.g. reconcile()).
async function flush(): Promise<void> {
  // A handful of microtask turns is enough to settle .then() chains we kick
  // off in subscribe callbacks.
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

import { afterEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "../event-handlers";
import { _resetEventBus, publishRunEvent, subscribeRunBus } from "../event-bus";

afterEach(() => _resetEventBus());

function ev(runId: string, sequence: number): RealtimeEvent {
  return {
    runId,
    sequence,
    eventType: "run.started",
    payload: {},
    promptExecutionId: null,
  };
}

describe("event-bus", () => {
  it("delivers events to subscribers in microtask", async () => {
    const fn = vi.fn();
    subscribeRunBus("r-1", fn);
    publishRunEvent(ev("r-1", 1));
    expect(fn).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("only delivers to listeners of matching runId", async () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeRunBus("r-1", a);
    subscribeRunBus("r-2", b);
    publishRunEvent(ev("r-1", 1));
    await Promise.resolve();
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
  });

  it("unsubscribe stops further delivery", async () => {
    const fn = vi.fn();
    const off = subscribeRunBus("r-1", fn);
    off();
    publishRunEvent(ev("r-1", 1));
    await Promise.resolve();
    expect(fn).not.toHaveBeenCalled();
  });

  it("a throwing listener does not block others", async () => {
    const bad = vi.fn(() => {
      throw new Error("nope");
    });
    const good = vi.fn();
    subscribeRunBus("r-1", bad);
    subscribeRunBus("r-1", good);
    publishRunEvent(ev("r-1", 1));
    await Promise.resolve();
    expect(good).toHaveBeenCalledOnce();
  });
});

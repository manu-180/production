import { beforeEach, describe, expect, it, vi } from "vitest";
import { CircuitBreaker } from "../circuit-breaker.js";

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T00:00:00Z"));
  });

  it("starts closed", () => {
    const cb = new CircuitBreaker();
    expect(cb.state()).toBe("closed");
    expect(cb.canAttempt()).toBe(true);
  });

  it("opens after threshold consecutive failures (default 3)", () => {
    const cb = new CircuitBreaker();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state()).toBe("closed");
    cb.recordFailure();
    expect(cb.state()).toBe("open");
    expect(cb.canAttempt()).toBe(false);
  });

  it("resets the counter on success", () => {
    const cb = new CircuitBreaker({ threshold: 3, cooldownMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.getConsecutiveFailures()).toBe(0);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state()).toBe("closed");
  });

  it("transitions OPEN -> HALF-OPEN after cooldown", () => {
    const cb = new CircuitBreaker({ threshold: 2, cooldownMs: 5000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state()).toBe("open");
    vi.advanceTimersByTime(4999);
    expect(cb.state()).toBe("open");
    vi.advanceTimersByTime(1);
    expect(cb.state()).toBe("half-open");
  });

  it("half-open allows exactly one trial", () => {
    const cb = new CircuitBreaker({ threshold: 2, cooldownMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(1000);
    expect(cb.state()).toBe("half-open");
    expect(cb.canAttempt()).toBe(true);
    // Second concurrent attempt is denied while trial is in flight
    expect(cb.canAttempt()).toBe(false);
  });

  it("half-open success closes the breaker", () => {
    const cb = new CircuitBreaker({ threshold: 2, cooldownMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(1000);
    cb.canAttempt();
    cb.recordSuccess();
    expect(cb.state()).toBe("closed");
  });

  it("half-open failure re-opens the breaker", () => {
    const cb = new CircuitBreaker({ threshold: 2, cooldownMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(1000);
    cb.canAttempt();
    cb.recordFailure();
    expect(cb.state()).toBe("open");
    // and another cooldown window must elapse
    vi.advanceTimersByTime(999);
    expect(cb.state()).toBe("open");
    vi.advanceTimersByTime(1);
    expect(cb.state()).toBe("half-open");
  });

  it("reset() clears all state", () => {
    const cb = new CircuitBreaker({ threshold: 1, cooldownMs: 1000 });
    cb.recordFailure();
    expect(cb.state()).toBe("open");
    cb.reset();
    expect(cb.state()).toBe("closed");
    expect(cb.getConsecutiveFailures()).toBe(0);
  });

  it("uses injected now() source", () => {
    let t = 1000;
    const cb = new CircuitBreaker({ threshold: 1, cooldownMs: 100, now: () => t });
    cb.recordFailure();
    expect(cb.state()).toBe("open");
    t = 1099;
    expect(cb.state()).toBe("open");
    t = 1101;
    expect(cb.state()).toBe("half-open");
  });
});

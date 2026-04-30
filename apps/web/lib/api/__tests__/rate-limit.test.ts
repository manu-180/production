import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRateLimiter, pickLimiter } from "../rate-limit";

describe("InMemoryRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to `limit` requests in the window then blocks", () => {
    const rl = new InMemoryRateLimiter({ limit: 3, windowMs: 60_000 });
    const k = "user:a";
    expect(rl.check(k).allowed).toBe(true);
    expect(rl.check(k).allowed).toBe(true);
    const third = rl.check(k);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = rl.check(k);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it("resets the counter after the window elapses", () => {
    const rl = new InMemoryRateLimiter({ limit: 2, windowMs: 1_000 });
    const k = "user:b";
    rl.check(k);
    rl.check(k);
    expect(rl.check(k).allowed).toBe(false);

    vi.advanceTimersByTime(1_001);
    const after = rl.check(k);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(1);
  });

  it("isolates buckets per key", () => {
    const rl = new InMemoryRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("b").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
  });

  it("reset() clears a specific key only", () => {
    const rl = new InMemoryRateLimiter({ limit: 1, windowMs: 60_000 });
    rl.check("a");
    rl.check("b");
    rl.reset("a");
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("b").allowed).toBe(false);
  });

  it("evicts oldest key once maxKeys is exceeded", () => {
    const rl = new InMemoryRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
    rl.check("a");
    rl.check("b");
    // "a" and "b" are capped now
    expect(rl.check("a").allowed).toBe(false);
    expect(rl.check("b").allowed).toBe(false);

    rl.check("c"); // forces eviction of "a" (oldest)

    // "a" was evicted → next request gets a fresh bucket
    expect(rl.check("a").allowed).toBe(true);
    // "c" was just inserted → still capped (count=1, limit=1)
    expect(rl.check("c").allowed).toBe(false);
  });
});

describe("pickLimiter", () => {
  it("returns null for 'none' and instances for the other tiers", () => {
    expect(pickLimiter("none")).toBeNull();
    expect(pickLimiter("general")).not.toBeNull();
    expect(pickLimiter("mutation")).not.toBeNull();
    expect(pickLimiter("stream")).not.toBeNull();
  });
});

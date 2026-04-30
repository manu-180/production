import { describe, expect, it } from "vitest";
import { ExecutorError, ExecutorErrorCode } from "../../executor/errors.js";
import { RateLimitTracker, parseRetryAfter } from "../rate-limit-handler.js";

describe("parseRetryAfter", () => {
  it("returns null when no hint", () => {
    const err = new ExecutorError(ExecutorErrorCode.RATE_LIMITED, "no hint");
    expect(parseRetryAfter(err)).toBeNull();
  });

  it("reads numeric Retry-After header (seconds)", () => {
    const err = new ExecutorError(ExecutorErrorCode.RATE_LIMITED, "x", {
      originalError: { headers: { "retry-after": 90 } },
    });
    expect(parseRetryAfter(err)).toBe(90_000);
  });

  it("reads stderr 'Retry-After: N'", () => {
    const err = new ExecutorError(ExecutorErrorCode.RATE_LIMITED, "x", {
      originalError: { stderr: "Got 429. Retry-After: 15" },
    });
    expect(parseRetryAfter(err)).toBe(15_000);
  });

  it("reads message 'wait N seconds'", () => {
    const err = new ExecutorError(ExecutorErrorCode.RATE_LIMITED, "please wait 8 seconds");
    expect(parseRetryAfter(err)).toBe(8_000);
  });
});

describe("RateLimitTracker", () => {
  it("allows up to maxWaitsPerPrompt and rejects beyond", () => {
    const t = new RateLimitTracker({ maxWaitsPerPrompt: 3 });
    expect(t.record("p1")).toEqual({ allowed: true, count: 1 });
    expect(t.record("p1")).toEqual({ allowed: true, count: 2 });
    expect(t.record("p1")).toEqual({ allowed: true, count: 3 });
    expect(t.record("p1")).toEqual({ allowed: false, count: 4 });
  });

  it("counters are per-prompt", () => {
    const t = new RateLimitTracker({ maxWaitsPerPrompt: 1 });
    expect(t.record("a").allowed).toBe(true);
    expect(t.record("a").allowed).toBe(false);
    // Different prompt has its own counter
    expect(t.record("b").allowed).toBe(true);
  });

  it("default cap is 5", () => {
    const t = new RateLimitTracker();
    expect(t.getMax()).toBe(5);
  });

  it("count() returns 0 for unseen prompts", () => {
    const t = new RateLimitTracker();
    expect(t.count("never")).toBe(0);
  });

  it("reset(promptId) clears one counter", () => {
    const t = new RateLimitTracker({ maxWaitsPerPrompt: 1 });
    t.record("p");
    t.reset("p");
    expect(t.count("p")).toBe(0);
    expect(t.record("p").allowed).toBe(true);
  });

  it("resetAll() clears every counter", () => {
    const t = new RateLimitTracker({ maxWaitsPerPrompt: 1 });
    t.record("a");
    t.record("b");
    t.resetAll();
    expect(t.count("a")).toBe(0);
    expect(t.count("b")).toBe(0);
  });
});

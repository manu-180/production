import { describe, expect, it } from "vitest";
import { DEFAULT_RETRY_POLICY, type RetryPolicy, nextDelay } from "../retry-policy.js";

const FIXED: RetryPolicy = {
  maxAttempts: 5,
  backoff: "fixed",
  initialDelayMs: 1000,
  maxDelayMs: 60_000,
  multiplier: 2,
};

const EXP: RetryPolicy = {
  maxAttempts: 5,
  backoff: "exponential",
  initialDelayMs: 1000,
  maxDelayMs: 60_000,
  multiplier: 2,
};

const JITTER: RetryPolicy = {
  maxAttempts: 5,
  backoff: "exponential-jitter",
  initialDelayMs: 1000,
  maxDelayMs: 60_000,
  multiplier: 2,
};

describe("nextDelay", () => {
  it("returns 0 for non-positive attempt", () => {
    expect(nextDelay(EXP, 0)).toBe(0);
    expect(nextDelay(EXP, -1)).toBe(0);
  });

  it("fixed strategy always returns initial delay", () => {
    expect(nextDelay(FIXED, 1)).toBe(1000);
    expect(nextDelay(FIXED, 2)).toBe(1000);
    expect(nextDelay(FIXED, 5)).toBe(1000);
  });

  it("exponential doubles each attempt", () => {
    expect(nextDelay(EXP, 1)).toBe(1000);
    expect(nextDelay(EXP, 2)).toBe(2000);
    expect(nextDelay(EXP, 3)).toBe(4000);
    expect(nextDelay(EXP, 4)).toBe(8000);
  });

  it("exponential is capped by maxDelayMs", () => {
    // attempt 7 -> 64s -> cap to 60s
    expect(nextDelay(EXP, 7)).toBe(60_000);
    // attempt 20 -> still cap
    expect(nextDelay(EXP, 20)).toBe(60_000);
  });

  it("exponential-jitter respects [0, base) bounds", () => {
    // With a fixed-zero random source, delay should be 0
    expect(nextDelay(JITTER, 3, () => 0)).toBe(0);
    // With a near-1 source, delay approaches base (4000) but never exceeds it
    const near = nextDelay(JITTER, 3, () => 0.999);
    expect(near).toBeGreaterThanOrEqual(0);
    expect(near).toBeLessThanOrEqual(4000);
  });

  it("exponential-jitter clamps to maxDelayMs", () => {
    // attempt 20 with random=1 -> base huge, cap to 60s
    expect(nextDelay(JITTER, 20, () => 0.99)).toBeLessThanOrEqual(60_000);
  });

  it("treats unknown strategy like fixed (defensive)", () => {
    const weird = { ...EXP, backoff: "weird" } as unknown as RetryPolicy;
    expect(nextDelay(weird, 5)).toBe(1000);
  });

  it("multiplier <= 0 falls back to 1", () => {
    const p: RetryPolicy = { ...EXP, multiplier: 0 };
    expect(nextDelay(p, 5)).toBe(1000);
  });

  it("DEFAULT_RETRY_POLICY is exponential-jitter, 3 attempts, 1s..60s", () => {
    expect(DEFAULT_RETRY_POLICY.backoff).toBe("exponential-jitter");
    expect(DEFAULT_RETRY_POLICY.maxAttempts).toBe(3);
    expect(DEFAULT_RETRY_POLICY.initialDelayMs).toBe(1000);
    expect(DEFAULT_RETRY_POLICY.maxDelayMs).toBe(60_000);
    expect(DEFAULT_RETRY_POLICY.multiplier).toBe(2);
  });
});

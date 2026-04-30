/**
 * Conductor — Retry Policy (Recovery)
 *
 * Pure module describing how to compute the next retry delay for a failed
 * attempt. Three strategies: fixed, exponential, exponential-jitter (default).
 *
 * The shape `RetryPolicy` here is the recovery-module variant. Note: there is
 * an unrelated `RetryPolicy` interface in `../types.ts` (legacy, used in a
 * different context). The two are kept independent on purpose.
 */

export type BackoffStrategy = "fixed" | "exponential" | "exponential-jitter";

export interface RetryPolicy {
  /** Maximum total attempts (including the initial attempt). */
  maxAttempts: number;
  backoff: BackoffStrategy;
  /** Initial delay in ms applied at attempt=1. */
  initialDelayMs: number;
  /** Hard cap on the computed delay. */
  maxDelayMs: number;
  /** Multiplier for exponential strategies. */
  multiplier: number;
}

/**
 * Project-wide default. Exponential with jitter, 3 attempts, 1s..60s, x2.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 3,
  backoff: "exponential-jitter",
  initialDelayMs: 1_000,
  maxDelayMs: 60_000,
  multiplier: 2,
});

/**
 * Pseudo-jitter source. Exposed so tests can inject a deterministic value.
 * Returns a value in [0, 1).
 */
export type RandomFn = () => number;

/**
 * Compute the delay (in ms) to wait *before* attempt number `attempt` (1-based:
 * attempt=1 means the first retry, attempt=0 means the initial attempt and
 * therefore returns 0).
 *
 * Pure: never reads the clock, never sleeps.
 */
export function nextDelay(
  policy: RetryPolicy,
  attempt: number,
  random: RandomFn = Math.random,
): number {
  if (!Number.isFinite(attempt) || attempt <= 0) return 0;

  const initial = Math.max(0, policy.initialDelayMs);
  const cap = Math.max(0, policy.maxDelayMs);
  const mult = policy.multiplier > 0 ? policy.multiplier : 1;

  let raw: number;
  switch (policy.backoff) {
    case "fixed":
      raw = initial;
      break;
    case "exponential":
      raw = initial * mult ** (attempt - 1);
      break;
    case "exponential-jitter": {
      const base = initial * mult ** (attempt - 1);
      // Full-jitter: pick a value in [0, base]. Avoids thundering herd.
      raw = random() * base;
      break;
    }
    default: {
      // Unknown strategy: behave like fixed.
      raw = initial;
    }
  }

  if (!Number.isFinite(raw) || raw < 0) raw = 0;
  return Math.min(Math.floor(raw), cap);
}

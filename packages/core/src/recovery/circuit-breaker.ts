/**
 * Conductor — Circuit Breaker (Recovery)
 *
 * Tracks a sliding count of consecutive failures. After `threshold` failures
 * the breaker is OPEN — callers should refuse to invoke the protected
 * operation. After `cooldownMs` the breaker becomes HALF-OPEN: a single trial
 * call is allowed; success closes the breaker, failure re-opens it for another
 * cooldown window.
 *
 * Pure / no I/O. Time is read via an injectable `now` source so tests can use
 * Vitest fake timers deterministically.
 */

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Consecutive failures required to trip the breaker. */
  threshold: number;
  /** Milliseconds to wait before transitioning OPEN -> HALF-OPEN. */
  cooldownMs: number;
  /** Time source. Defaults to {@link Date.now}. */
  now?: () => number;
}

const DEFAULT_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 5 * 60_000;

export class CircuitBreaker {
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  /** Marks that we've granted the half-open trial slot. */
  private trialInFlight = false;

  constructor(opts: Partial<CircuitBreakerOptions> = {}) {
    this.threshold = opts.threshold ?? DEFAULT_THRESHOLD;
    this.cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = opts.now ?? Date.now;
  }

  /** Current state. Computed from internal counters + clock. */
  state(): CircuitState {
    if (this.openedAt === null) return "closed";
    const elapsed = this.now() - this.openedAt;
    if (elapsed < this.cooldownMs) return "open";
    return "half-open";
  }

  /**
   * Whether a caller may attempt the protected operation right now. In
   * half-open state only a single concurrent trial is permitted.
   */
  canAttempt(): boolean {
    const s = this.state();
    if (s === "closed") return true;
    if (s === "open") return false;
    // half-open
    if (this.trialInFlight) return false;
    this.trialInFlight = true;
    return true;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.trialInFlight = false;
  }

  recordFailure(): void {
    this.trialInFlight = false;
    if (this.state() === "half-open") {
      // Trial failed -> reopen the breaker for another cooldown window.
      this.openedAt = this.now();
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.threshold && this.openedAt === null) {
      this.openedAt = this.now();
    }
  }

  /** For introspection / tests. */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  /** Reset to the closed state, clearing all counters. */
  reset(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.trialInFlight = false;
  }
}

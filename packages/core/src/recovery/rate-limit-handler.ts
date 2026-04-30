/**
 * Conductor — Rate Limit Handler (Recovery)
 *
 * Two responsibilities:
 *  1. {@link parseRetryAfter} — extract a wait hint (ms) from an
 *     {@link ExecutorError}. Re-exports `extractRetryAfterMs` from
 *     `error-classifier` under the canonical name used by the plan, with the
 *     same semantics.
 *  2. {@link RateLimitTracker} — caps the number of rate-limit waits per
 *     prompt. The plan calls out "max 5 rate-limit waits per prompt" as a
 *     separate cap from regular retries (so a long-running rate-limit storm
 *     does not consume the prompt's normal retry budget).
 */

import type { ExecutorError } from "../executor/errors.js";
import { extractRetryAfterMs } from "./error-classifier.js";

const DEFAULT_MAX_WAITS_PER_PROMPT = 5;

/**
 * Returns the suggested wait (in milliseconds) before retrying a rate-limited
 * call, or null when no hint can be extracted from the error payload.
 */
export function parseRetryAfter(err: ExecutorError): number | null {
  return extractRetryAfterMs(err);
}

export interface RateLimitTrackerOptions {
  /** Max rate-limit waits allowed for a single prompt. Default 5. */
  maxWaitsPerPrompt?: number;
}

/**
 * Per-prompt counter of rate-limit waits. Independent from the regular retry
 * budget. Once a prompt exhausts its rate-limit waits the tracker reports
 * `false` from {@link record} and the orchestrator should treat the failure
 * as terminal.
 */
export class RateLimitTracker {
  private readonly max: number;
  private readonly counters = new Map<string, number>();

  constructor(opts: RateLimitTrackerOptions = {}) {
    this.max = opts.maxWaitsPerPrompt ?? DEFAULT_MAX_WAITS_PER_PROMPT;
  }

  /**
   * Record a rate-limit wait for `promptId`. Returns:
   *  - `{ allowed: true,  count }` if the prompt may wait + retry again
   *  - `{ allowed: false, count }` if the prompt has hit the cap
   */
  record(promptId: string): { allowed: boolean; count: number } {
    const next = (this.counters.get(promptId) ?? 0) + 1;
    this.counters.set(promptId, next);
    return { allowed: next <= this.max, count: next };
  }

  /** Current count for `promptId` (0 if unseen). */
  count(promptId: string): number {
    return this.counters.get(promptId) ?? 0;
  }

  /** Reset the counter for one prompt (called after a successful execution). */
  reset(promptId: string): void {
    this.counters.delete(promptId);
  }

  /** Reset every counter. Used in tests / between runs. */
  resetAll(): void {
    this.counters.clear();
  }

  /** Configured cap. */
  getMax(): number {
    return this.max;
  }
}

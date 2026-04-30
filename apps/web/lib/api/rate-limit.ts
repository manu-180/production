/**
 * Process-local fixed-window rate limiter.
 *
 * Why in-memory and not Upstash yet: the worker and web run on the same host
 * for now, and we don't want to add a Redis dependency until we actually
 * scale horizontally. The interface mirrors `@upstash/ratelimit` so we can
 * swap implementations without touching the routes.
 *
 * Limitation: counters reset on process restart, and they are not shared
 * across replicas. Acceptable for single-host dev/prod-of-one. When that
 * stops being acceptable, swap `InMemoryRateLimiter` for an Upstash adapter
 * exposing the same `check()` / `reset()` surface.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitConfig {
  /** Max requests inside `windowMs`. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Optional safety cap on stored keys, oldest-evicted when crossed. Defaults to 10k. */
  maxKeys?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
  reset(key: string): void;
  clear(): void;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly store = new Map<string, Bucket>();
  private readonly maxKeys: number;

  constructor(private readonly config: RateLimitConfig) {
    this.maxKeys = config.maxKeys ?? 10_000;
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    const existing = this.store.get(key);

    if (existing === undefined || existing.resetAt <= now) {
      const fresh: Bucket = { count: 1, resetAt: now + this.config.windowMs };
      this.store.set(key, fresh);
      this.evictIfOversize();
      return {
        allowed: true,
        remaining: this.config.limit - 1,
        resetAt: fresh.resetAt,
        limit: this.config.limit,
      };
    }

    if (existing.count >= this.config.limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: existing.resetAt,
        limit: this.config.limit,
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: this.config.limit - existing.count,
      resetAt: existing.resetAt,
      limit: this.config.limit,
    };
  }

  reset(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  private evictIfOversize(): void {
    if (this.store.size <= this.maxKeys) return;
    // Map preserves insertion order; drop the oldest entry.
    const oldestKey = this.store.keys().next().value;
    if (oldestKey !== undefined) this.store.delete(oldestKey);
  }
}

/** Default limiters used by `defineRoute()`. Tunable via env later. */
export const generalLimiter: RateLimiter = new InMemoryRateLimiter({
  limit: 60,
  windowMs: 60_000,
});

export const mutationLimiter: RateLimiter = new InMemoryRateLimiter({
  limit: 30,
  windowMs: 60_000,
});

export const streamLimiter: RateLimiter = new InMemoryRateLimiter({
  limit: 5,
  windowMs: 60_000,
});

export type RateLimitTier = "general" | "mutation" | "stream" | "none";

export function pickLimiter(tier: RateLimitTier): RateLimiter | null {
  switch (tier) {
    case "general":
      return generalLimiter;
    case "mutation":
      return mutationLimiter;
    case "stream":
      return streamLimiter;
    case "none":
      return null;
  }
}

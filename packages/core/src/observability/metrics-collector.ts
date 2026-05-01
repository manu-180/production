import type { DbClient } from "../guardian/audit-log.js";
/**
 * Conductor — Metrics Collector
 *
 * Queries the materialized views created by the Phase 13 DB migration:
 *   - metrics_runs_daily
 *   - metrics_prompts_aggregate
 *   - metrics_guardian_daily
 *
 * Never throws — returns empty arrays on any DB or runtime error.
 */
import { type Logger, createLogger } from "../logger.js";

export type { DbClient };

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface RunsDailyMetric {
  day: string;
  userId: string;
  totalRuns: number;
  successful: number;
  failed: number;
  cancelled: number;
  avgDurationS: number | null;
  totalCostUsd: number;
  totalInput: number;
  totalOutput: number;
}

export interface PromptMetric {
  id: string;
  title: string;
  planId: string;
  totalExecutions: number;
  succeeded: number;
  failed: number;
  avgDurationMs: number | null;
  avgCostUsd: number | null;
  avgTokens: number | null;
}

export interface GuardianDailyMetric {
  day: string;
  strategy: "rule" | "default" | "llm";
  avgConfidence: number;
  totalDecisions: number;
  humanReviewed: number;
  overridden: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

const RUNS_DAILY_VIEW = "metrics_runs_daily";
const PROMPTS_AGGREGATE_VIEW = "metrics_prompts_aggregate";
const GUARDIAN_DAILY_VIEW = "metrics_guardian_daily";

export class MetricsCollector {
  private readonly logger: Logger;

  constructor(private readonly db: DbClient) {
    this.logger = createLogger("observability:metrics-collector");
  }

  /**
   * Returns daily run metrics for a user, ordered by day DESC.
   * Defaults to the last 30 days.
   */
  async getRunsDaily(userId: string, days = 30): Promise<RunsDailyMetric[]> {
    try {
      const since = daysAgoIso(days);
      const result = await this.db
        .from(RUNS_DAILY_VIEW)
        .select("*")
        .eq("user_id", userId)
        .order("day", { ascending: false });

      if (result.error !== null) {
        this.logger.warn({ err: result.error.message, userId }, "metrics_runs_daily query failed");
        return [];
      }

      return (result.data ?? [])
        .filter((row) => {
          const day = row["day"];
          return typeof day === "string" && day >= since;
        })
        .map(rowToRunsDailyMetric);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: message, userId }, "getRunsDaily threw");
      return [];
    }
  }

  /**
   * Returns aggregate prompt metrics, optionally filtered by planId.
   */
  async getPromptsAggregate(planId?: string): Promise<PromptMetric[]> {
    try {
      let query = this.db.from(PROMPTS_AGGREGATE_VIEW).select("*");
      if (planId !== undefined) {
        query = query.eq("plan_id", planId);
      }
      const result = await query;

      if (result.error !== null) {
        this.logger.warn(
          { err: result.error.message, planId },
          "metrics_prompts_aggregate query failed",
        );
        return [];
      }

      return (result.data ?? []).map(rowToPromptMetric);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: message, planId }, "getPromptsAggregate threw");
      return [];
    }
  }

  /**
   * Returns daily Guardian metrics, ordered by day DESC.
   * Defaults to the last 30 days.
   */
  async getGuardianDaily(days = 30): Promise<GuardianDailyMetric[]> {
    try {
      const since = daysAgoIso(days);
      const result = await this.db
        .from(GUARDIAN_DAILY_VIEW)
        .select("*")
        .order("day", { ascending: false });

      if (result.error !== null) {
        this.logger.warn({ err: result.error.message }, "metrics_guardian_daily query failed");
        return [];
      }

      return (result.data ?? [])
        .filter((row) => {
          const day = row["day"];
          return typeof day === "string" && day >= since;
        })
        .map(rowToGuardianDailyMetric);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: message }, "getGuardianDaily threw");
      return [];
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function numOr(value: unknown, fallback: number): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function rowToRunsDailyMetric(row: Record<string, unknown>): RunsDailyMetric {
  return {
    day: stringOr(row["day"], ""),
    userId: stringOr(row["user_id"], ""),
    totalRuns: numOr(row["total_runs"], 0),
    successful: numOr(row["successful"], 0),
    failed: numOr(row["failed"], 0),
    cancelled: numOr(row["cancelled"], 0),
    avgDurationS: numOrNull(row["avg_duration_s"]),
    totalCostUsd: numOr(row["total_cost_usd"], 0),
    totalInput: numOr(row["total_input"], 0),
    totalOutput: numOr(row["total_output"], 0),
  };
}

function rowToPromptMetric(row: Record<string, unknown>): PromptMetric {
  return {
    id: stringOr(row["id"], ""),
    title: stringOr(row["title"], ""),
    planId: stringOr(row["plan_id"], ""),
    totalExecutions: numOr(row["total_executions"], 0),
    succeeded: numOr(row["succeeded"], 0),
    failed: numOr(row["failed"], 0),
    avgDurationMs: numOrNull(row["avg_duration_ms"]),
    avgCostUsd: numOrNull(row["avg_cost_usd"]),
    avgTokens: numOrNull(row["avg_tokens"]),
  };
}

function rowToGuardianDailyMetric(row: Record<string, unknown>): GuardianDailyMetric {
  const strategy = row["strategy"];
  const safeStrategy: "rule" | "default" | "llm" =
    strategy === "rule" || strategy === "llm" ? strategy : "default";

  return {
    day: stringOr(row["day"], ""),
    strategy: safeStrategy,
    avgConfidence: numOr(row["avg_confidence"], 0),
    totalDecisions: numOr(row["total_decisions"], 0),
    humanReviewed: numOr(row["human_reviewed"], 0),
    overridden: numOr(row["overridden"], 0),
  };
}

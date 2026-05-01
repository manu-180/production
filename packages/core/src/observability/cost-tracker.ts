import type { DbClient } from "../guardian/audit-log.js";
/**
 * Conductor — Cost Tracker
 *
 * Monthly cost aggregation queried directly from the `runs` table.
 * Never throws — returns zeros on any DB or runtime error.
 */
import { type Logger, createLogger } from "../logger.js";

export type { DbClient };

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface MonthlyCost {
  /** Month in 'YYYY-MM' format. */
  month: string;
  totalCostUsd: number;
  runCount: number;
  /**
   * Cost delta vs. the prior month as a percentage.
   * `null` when no prior-month data is available.
   */
  deltaPercent: number | null;
}

export interface CostByModel {
  /**
   * Since model info isn't currently stored per-run, this returns the total
   * cost only (placeholder for future per-model breakdown).
   */
  totalCostUsd: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

const RUNS_TABLE = "runs";

export class CostTracker {
  private readonly logger: Logger;

  constructor(private readonly db: DbClient) {
    this.logger = createLogger("observability:cost-tracker");
  }

  /**
   * Returns the cost summary for the current calendar month.
   * Also fetches the prior month to compute the delta percentage.
   * Returns zeros on any DB or runtime error.
   */
  async getCurrentMonthCost(userId: string): Promise<MonthlyCost> {
    const now = new Date();
    const currentMonth = toYearMonth(now);
    const currentStart = `${currentMonth}-01`;
    const currentEnd = monthEnd(now);

    const priorDate = priorMonth(now);
    const priorMonthStr = toYearMonth(priorDate);
    const priorStart = `${priorMonthStr}-01`;
    const priorEnd = monthEnd(priorDate);

    try {
      const [currentResult, priorResult] = await Promise.all([
        queryMonthCost(this.db, userId, currentStart, currentEnd),
        queryMonthCost(this.db, userId, priorStart, priorEnd),
      ]);

      if (currentResult.error !== null) {
        this.logger.warn(
          { err: currentResult.error, userId, month: currentMonth },
          "getCurrentMonthCost query failed",
        );
        return zeroCost(currentMonth);
      }

      const totalCostUsd = currentResult.totalCostUsd;
      const runCount = currentResult.runCount;

      let deltaPercent: number | null = null;
      if (priorResult.error === null && priorResult.totalCostUsd > 0) {
        deltaPercent = ((totalCostUsd - priorResult.totalCostUsd) / priorResult.totalCostUsd) * 100;
      } else if (
        priorResult.error === null &&
        priorResult.totalCostUsd === 0 &&
        totalCostUsd === 0
      ) {
        deltaPercent = 0;
      }

      return { month: currentMonth, totalCostUsd, runCount, deltaPercent };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: message, userId }, "getCurrentMonthCost threw");
      return zeroCost(currentMonth);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function toYearMonth(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthEnd(date: Date): string {
  // First day of next month at midnight UTC = exclusive upper bound
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1; // 1-based next month
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
}

function priorMonth(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  return d;
}

function zeroCost(month: string): MonthlyCost {
  return { month, totalCostUsd: 0, runCount: 0, deltaPercent: null };
}

interface MonthQueryResult {
  totalCostUsd: number;
  runCount: number;
  error: string | null;
}

/**
 * Query `runs` for [start, end) interval.
 * The `DbClient` interface doesn't expose aggregation so we fetch rows and
 * sum them in-process — acceptable for monthly rollups which are small.
 */
async function queryMonthCost(
  db: DbClient,
  userId: string,
  start: string,
  end: string,
): Promise<MonthQueryResult> {
  try {
    // We need created_at >= start AND created_at < end.
    // DbClient only has .eq() but we can chain two inequalities via .order +
    // filtering in JS, since the interface is intentionally minimal.
    // For correctness we select the cost + created_at columns and filter in JS.
    const result = await db
      .from(RUNS_TABLE)
      .select("total_cost_usd,created_at")
      .eq("user_id", userId);

    if (result.error !== null) {
      return { totalCostUsd: 0, runCount: 0, error: result.error.message };
    }

    const rows = (result.data ?? []).filter((row) => {
      const ts = row["created_at"];
      if (typeof ts !== "string") return false;
      const day = ts.slice(0, 10);
      return day >= start && day < end;
    });

    let totalCostUsd = 0;
    for (const row of rows) {
      const cost = row["total_cost_usd"];
      if (typeof cost === "number") totalCostUsd += cost;
      else if (typeof cost === "string") {
        const n = Number(cost);
        if (Number.isFinite(n)) totalCostUsd += n;
      }
    }

    return { totalCostUsd, runCount: rows.length, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { totalCostUsd: 0, runCount: 0, error: message };
  }
}

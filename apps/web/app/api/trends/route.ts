import { defineRoute, respond, respondError } from "@/lib/api";

export const dynamic = "force-dynamic";

type DailyCostEntry = { date: string; costUsd: number; runs: number };

type StatusCounts = {
  completed: number;
  failed: number;
  cancelled: number;
  running: number;
};

type Kpis = {
  successRate30d: number;
  totalCost30d: number;
  avgDurationMs: number | null;
  totalRuns30d: number;
};

type TrendsResponse = {
  dailyCost: DailyCostEntry[];
  statusCounts: StatusCounts;
  kpis: Kpis;
};

/**
 * GET /api/trends
 *
 * Returns cost/run trends for the last 30 days, status breakdown, and derived KPIs.
 * Days with no runs are filled with zeros so charts render without gaps.
 */
export const GET = defineRoute({}, async ({ user, traceId }) => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // 30-day window: 29 days ago → today (inclusive)
  const since = new Date(today);
  since.setUTCDate(since.getUTCDate() - 29);

  const { data, error } = await user.db
    .from("runs")
    .select("started_at, finished_at, total_cost_usd, status")
    .eq("user_id", user.userId)
    .gte("started_at", since.toISOString());

  if (error !== null) {
    return respondError("internal", "Failed to load trends", {
      traceId,
      details: { code: error.code },
    });
  }

  const rows = data ?? [];

  // Pre-fill all 30 days with zeros so the chart has no gaps
  const dayMap = new Map<string, { costUsd: number; runs: number }>();
  for (let i = 0; i < 30; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    dayMap.set(d.toISOString().slice(0, 10), { costUsd: 0, runs: 0 });
  }

  const statusCounts: StatusCounts = { completed: 0, failed: 0, cancelled: 0, running: 0 };
  let totalDurationMs = 0;
  let durationCount = 0;
  let totalCost30d = 0;

  for (const row of rows) {
    const cost = Number(row.total_cost_usd ?? 0);
    totalCost30d += cost;

    if (row.started_at) {
      const key = (row.started_at as string).slice(0, 10);
      const entry = dayMap.get(key);
      if (entry !== undefined) {
        entry.costUsd += cost;
        entry.runs += 1;
      }
    }

    if (row.status === "completed") statusCounts.completed++;
    else if (row.status === "failed") statusCounts.failed++;
    else if (row.status === "cancelled") statusCounts.cancelled++;
    else if (row.status === "running") statusCounts.running++;

    if (row.started_at && row.finished_at) {
      const ms =
        new Date(row.finished_at as string).getTime() -
        new Date(row.started_at as string).getTime();
      if (ms >= 0) {
        totalDurationMs += ms;
        durationCount++;
      }
    }
  }

  const dailyCost: DailyCostEntry[] = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { costUsd, runs }]) => ({ date, costUsd, runs }));

  const terminalCount = statusCounts.completed + statusCounts.failed + statusCounts.cancelled;
  const successRate30d = terminalCount === 0 ? 0 : statusCounts.completed / terminalCount;
  const avgDurationMs = durationCount === 0 ? null : totalDurationMs / durationCount;

  return respond<TrendsResponse>(
    {
      dailyCost,
      statusCounts,
      kpis: {
        successRate30d,
        totalCost30d,
        avgDurationMs,
        totalRuns30d: rows.length,
      },
    },
    { traceId },
  );
});

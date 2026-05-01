"use client";
import { KpiCard } from "@/app/dashboard/_components/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useInsightsMetrics } from "@/hooks/use-insights-metrics";
import { daysAgoIso, formatUsd } from "@/lib/ui/format";
import { Activity, Clock, DollarSign, TrendingUp } from "lucide-react";
import { CostBreakdown } from "./_components/cost-breakdown";
import { Leaderboard } from "./_components/leaderboard";
import { PieChart } from "./_components/pie-chart";
import { TimeSeriesChart } from "./_components/time-series-chart";

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InsightsOverviewPage() {
  const { data, isLoading, isError } = useInsightsMetrics(30);

  // ── KPI calculations (last 7 days) ──────────────────────────────────────────
  const since7d = daysAgoIso(7);
  const last7dRows = data?.runsByDay.filter((r) => r.day >= since7d) ?? [];

  const runs7d = last7dRows.reduce((acc, r) => acc + r.totalRuns, 0);
  const successful7d = last7dRows.reduce((acc, r) => acc + r.successful, 0);
  const failed7d = last7dRows.reduce((acc, r) => acc + r.failed, 0);
  const cancelled7d = last7dRows.reduce((acc, r) => acc + r.cancelled, 0);
  const total7dFinished = successful7d + failed7d + cancelled7d;
  const successRate7d = total7dFinished > 0 ? successful7d / total7dFinished : null;

  const durRows7d = last7dRows.filter((r) => r.avgDurationS !== null);
  const avgDuration7d =
    durRows7d.length > 0
      ? durRows7d.reduce((acc, r) => acc + (r.avgDurationS ?? 0), 0) / durRows7d.length
      : null;

  const cost7d = last7dRows.reduce((acc, r) => acc + r.totalCostUsd, 0);

  // ── Time series data ─────────────────────────────────────────────────────────
  const timeSeriesData = (data?.runsByDay ?? []).map((r) => ({
    day: r.day,
    successful: r.successful,
    failed: r.failed,
    cancelled: r.cancelled,
  }));

  // ── Pie chart data (all-time from runsByDay) ─────────────────────────────────
  const allSuccessful = (data?.runsByDay ?? []).reduce((acc, r) => acc + r.successful, 0);
  const allFailed = (data?.runsByDay ?? []).reduce((acc, r) => acc + r.failed, 0);
  const allCancelled = (data?.runsByDay ?? []).reduce((acc, r) => acc + r.cancelled, 0);

  const pieData = [
    { name: "Successful", value: allSuccessful, color: "#10b981" },
    { name: "Failed", value: allFailed, color: "#ef4444" },
    { name: "Cancelled", value: allCancelled, color: "#f59e0b" },
  ];

  // ── Leaderboard data ─────────────────────────────────────────────────────────
  // promptStats has plan_id; aggregate run counts per plan
  const leaderboardRuns = (data?.promptStats ?? []).map((p) => ({
    plan_id: p.planId || null,
    total_runs: p.totalExecutions,
  }));

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-7xl flex flex-col gap-8 pb-10">
      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load metrics. Refresh to try again.
        </div>
      )}

      {/* ── Section 1: KPI cards ── */}
      <section>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KpiCard
            label="Runs (7d)"
            value={isLoading ? "—" : runs7d}
            delta="last 7 days"
            icon={Activity}
            tone="info"
            loading={isLoading}
          />
          <KpiCard
            label="Success rate (7d)"
            value={isLoading ? "—" : successRate7d !== null ? formatPercent(successRate7d) : "—"}
            delta={total7dFinished > 0 ? `${total7dFinished} finished` : "no finished runs"}
            icon={TrendingUp}
            tone={successRate7d === null ? "neutral" : successRate7d >= 0.8 ? "success" : "warning"}
            loading={isLoading}
          />
          <KpiCard
            label="Avg duration (7d)"
            value={isLoading ? "—" : formatDuration(avgDuration7d)}
            delta="per run"
            icon={Clock}
            tone="neutral"
            loading={isLoading}
          />
          <KpiCard
            label="Total cost (7d)"
            value={isLoading ? "—" : formatUsd(cost7d)}
            delta="estimated"
            icon={DollarSign}
            tone="neutral"
            loading={isLoading}
          />
        </div>
      </section>

      {/* ── Section 2: Time series ── */}
      <section>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Runs per day (last 30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <TimeSeriesChart data={timeSeriesData} />
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Section 3: Pie + Cost ── */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Runs by status (all time)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-56 w-full" /> : <PieChart data={pieData} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Cost breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex gap-4">
                <Skeleton className="h-20 flex-1" />
                <Skeleton className="h-20 flex-1" />
              </div>
            ) : (
              <CostBreakdown runsByDay={data?.runsByDay ?? []} />
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Section 4: Leaderboard ── */}
      <section>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Top plans by run count</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
                  <Skeleton key={i} className="h-5 w-full" />
                ))}
              </div>
            ) : (
              <Leaderboard runs={leaderboardRuns} />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

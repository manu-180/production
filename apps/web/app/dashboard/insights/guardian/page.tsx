"use client";

import { Activity, BarChart3, TrendingUp } from "lucide-react";

import { KpiCard } from "@/app/dashboard/_components/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useInsightsMetrics } from "@/hooks/use-insights-metrics";
import type { GuardianDailyMetric } from "@conductor/core";

import { ConfidenceTrendChart } from "../_components/confidence-trend-chart";
import { PieChart } from "../_components/pie-chart";

// ─── Colors ────────────────────────────────────────────────────────────────────

const STRATEGY_COLORS: Record<GuardianDailyMetric["strategy"], string> = {
  rule: "#0ea5e9", // sky
  default: "#8b5cf6", // violet
  llm: "#10b981", // emerald
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatConfidence(n: number): string {
  return n.toFixed(3);
}

function strategyLabel(s: GuardianDailyMetric["strategy"]): string {
  const map: Record<GuardianDailyMetric["strategy"], string> = {
    rule: "Rule",
    default: "Default",
    llm: "LLM",
  };
  return map[s];
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function GuardianInsightsPage() {
  const metricsQuery = useInsightsMetrics(30);

  const isLoading = metricsQuery.isLoading;
  const isError = metricsQuery.isError;
  const guardianByDay: GuardianDailyMetric[] = metricsQuery.data?.guardianByDay ?? [];

  // ─── KPI calculations ──────────────────────────────────────────────────────

  const totalDecisions = guardianByDay.reduce((sum, r) => sum + r.totalDecisions, 0);

  const weightedConfidenceSum = guardianByDay.reduce(
    (sum, r) => sum + r.avgConfidence * r.totalDecisions,
    0,
  );
  const avgConfidence = totalDecisions > 0 ? weightedConfidenceSum / totalDecisions : 0;

  const totalOverridden = guardianByDay.reduce((sum, r) => sum + r.overridden, 0);
  const overrideRate = totalDecisions > 0 ? (totalOverridden / totalDecisions) * 100 : 0;

  // ─── Strategy distribution (pie) ──────────────────────────────────────────

  const strategyTotals = guardianByDay.reduce<Record<GuardianDailyMetric["strategy"], number>>(
    (acc, r) => {
      acc[r.strategy] = (acc[r.strategy] ?? 0) + r.totalDecisions;
      return acc;
    },
    { rule: 0, default: 0, llm: 0 },
  );

  const pieData = (["rule", "default", "llm"] as const).map((s) => ({
    name: strategyLabel(s),
    value: strategyTotals[s],
    color: STRATEGY_COLORS[s],
  }));

  // ─── Daily table (sorted DESC by day) ─────────────────────────────────────

  const sortedRows = [...guardianByDay].sort((a, b) => {
    const dayCmp = b.day.localeCompare(a.day);
    if (dayCmp !== 0) return dayCmp;
    return a.strategy.localeCompare(b.strategy);
  });

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-7xl flex flex-col gap-6 pb-10">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Guardian Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Decision patterns and confidence metrics.
        </p>
      </div>

      {/* Error banner */}
      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load Guardian data. Refresh to try again.
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && guardianByDay.length === 0 && (
        <div className="py-10 text-center text-sm text-muted-foreground">
          No Guardian decisions recorded yet.
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Total decisions"
          value={isLoading ? "—" : totalDecisions.toLocaleString()}
          icon={BarChart3}
          tone="info"
          loading={isLoading}
        />
        <KpiCard
          label="Avg confidence"
          value={isLoading ? "—" : formatConfidence(avgConfidence)}
          icon={TrendingUp}
          tone="success"
          loading={isLoading}
        />
        <KpiCard
          label="Override rate"
          value={isLoading ? "—" : `${overrideRate.toFixed(1)}%`}
          icon={Activity}
          tone={overrideRate > 20 ? "warning" : "neutral"}
          loading={isLoading}
        />
      </div>

      {/* Charts row */}
      {(isLoading || guardianByDay.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Strategy distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Strategy distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex h-48 items-center justify-center">
                  <Skeleton className="h-40 w-40 rounded-full" />
                </div>
              ) : (
                <PieChart data={pieData} />
              )}
            </CardContent>
          </Card>

          {/* Daily confidence trend */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Daily confidence trend</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
                    <Skeleton key={i} className="h-6 w-full" />
                  ))}
                </div>
              ) : (
                <ConfidenceTrendChart data={guardianByDay} />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Daily decisions table */}
      {(isLoading || guardianByDay.length > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Daily decisions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex flex-col gap-2 p-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead>Strategy</TableHead>
                    <TableHead className="text-right">Avg confidence</TableHead>
                    <TableHead className="text-right">Total decisions</TableHead>
                    <TableHead className="text-right">Human reviewed</TableHead>
                    <TableHead className="text-right">Overridden</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.map((row) => (
                    <TableRow key={`${row.day}-${row.strategy}`}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.day}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <span
                            className="inline-block size-2 rounded-full"
                            style={{ background: STRATEGY_COLORS[row.strategy] }}
                            aria-hidden="true"
                          />
                          {strategyLabel(row.strategy)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {formatConfidence(row.avgConfidence)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {row.totalDecisions.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {row.humanReviewed.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {row.overridden.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

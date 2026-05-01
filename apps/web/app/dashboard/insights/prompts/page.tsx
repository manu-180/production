"use client";

import type { Plan } from "@conductor/db";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

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
import { apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";
import { formatCostUsd, formatDuration } from "@/lib/ui/format";
import type { PromptMetric } from "@conductor/core";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface PlansResponse {
  plans: Plan[];
}

type SortColumn =
  | "title"
  | "plan"
  | "totalExecutions"
  | "successRate"
  | "avgDurationMs"
  | "avgCostUsd"
  | "avgTokens"
  | null;

type SortDirection = "asc" | "desc";

interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatTokens(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatAvgCost(n: number | null): string {
  if (n === null) return "—";
  return formatCostUsd(n);
}

function formatAvgDuration(ms: number | null): string {
  if (ms === null) return "—";
  return formatDuration(ms);
}

function truncateTitle(title: string, maxLen = 60): string {
  if (title.length <= maxLen) return title;
  return `${title.slice(0, maxLen - 1)}…`;
}

function getSuccessRate(metric: PromptMetric): number {
  if (metric.totalExecutions === 0) return 0;
  return (metric.succeeded / metric.totalExecutions) * 100;
}

function successRateColor(rate: number): string {
  if (rate >= 80) return "text-emerald-600";
  if (rate >= 50) return "text-amber-500";
  return "text-red-500";
}

// ─── Sort utils ────────────────────────────────────────────────────────────────

function getPromptSortValue(
  metric: PromptMetric,
  column: SortColumn,
  planMap: Map<string, string>,
): string | number | null {
  switch (column) {
    case "title":
      return metric.title;
    case "plan":
      return planMap.get(metric.planId) ?? metric.planId;
    case "totalExecutions":
      return metric.totalExecutions;
    case "successRate":
      return getSuccessRate(metric);
    case "avgDurationMs":
      return metric.avgDurationMs ?? -1;
    case "avgCostUsd":
      return metric.avgCostUsd ?? -1;
    case "avgTokens":
      return metric.avgTokens ?? -1;
    default:
      return null;
  }
}

function sortPrompts(
  metrics: PromptMetric[],
  sort: SortState,
  planMap: Map<string, string>,
): PromptMetric[] {
  if (sort.column === null) return metrics;

  return [...metrics].sort((a, b) => {
    const va = getPromptSortValue(a, sort.column, planMap);
    const vb = getPromptSortValue(b, sort.column, planMap);

    let cmp = 0;
    if (va === null && vb === null) cmp = 0;
    else if (va === null) cmp = 1;
    else if (vb === null) cmp = -1;
    else if (typeof va === "string" && typeof vb === "string") {
      cmp = va.localeCompare(vb);
    } else if (typeof va === "number" && typeof vb === "number") {
      cmp = va - vb;
    }

    return sort.direction === "asc" ? cmp : -cmp;
  });
}

// ─── SortableHeader ────────────────────────────────────────────────────────────

interface SortableHeaderProps {
  column: SortColumn;
  label: string;
  sort: SortState;
  onSort: (col: SortColumn) => void;
}

function SortableHeader({ column, label, sort, onSort }: SortableHeaderProps) {
  const active = sort.column === column;

  const Icon = !active ? ChevronsUpDown : sort.direction === "asc" ? ChevronUp : ChevronDown;

  return (
    <TableHead>
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 text-left font-medium hover:text-foreground transition-colors"
      >
        {label}
        <Icon className="size-3 text-muted-foreground" aria-hidden="true" />
      </button>
    </TableHead>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function PromptsInsightsPage() {
  const [sort, setSort] = useState<SortState>({
    column: "totalExecutions",
    direction: "desc",
  });

  const metricsQuery = useInsightsMetrics(30);

  const plansQuery = useQuery<PlansResponse>({
    queryKey: qk.plans.list({ limit: 200 }),
    queryFn: ({ signal }) => apiClient.get<PlansResponse>("/api/plans?limit=200", { signal }),
    staleTime: 60_000,
  });

  const isLoading = metricsQuery.isLoading || plansQuery.isLoading;
  const isError = metricsQuery.isError || plansQuery.isError;

  // Build plan id → name map
  const planMap = new Map<string, string>();
  for (const plan of plansQuery.data?.plans ?? []) {
    planMap.set(plan.id, plan.name);
  }

  const allPrompts = metricsQuery.data?.promptStats ?? [];
  const sorted = sortPrompts(allPrompts, sort, planMap);

  // Compute problematic prompts count
  const problematicCount = allPrompts.filter((p) => getSuccessRate(p) < 80).length;

  function handleSort(col: SortColumn) {
    setSort((prev) => {
      if (prev.column !== col) return { column: col, direction: "asc" };
      if (prev.direction === "asc") return { column: col, direction: "desc" };
      // cycle: asc → desc → back to default
      return { column: "totalExecutions", direction: "desc" };
    });
  }

  return (
    <div className="mx-auto max-w-7xl flex flex-col gap-6 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Prompt Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Performance stats per prompt across all runs.
          </p>
        </div>
      </div>

      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load prompt data. Refresh to try again.
        </div>
      )}

      {!isLoading && problematicCount > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          ⚠ {problematicCount} prompt{problematicCount !== 1 ? "s" : ""} have success rate below 80%
          and may need attention.
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">All prompts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : allPrompts.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No prompt data found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHeader column="title" label="Prompt" sort={sort} onSort={handleSort} />
                  <SortableHeader column="plan" label="Plan" sort={sort} onSort={handleSort} />
                  <SortableHeader
                    column="totalExecutions"
                    label="Executions"
                    sort={sort}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="successRate"
                    label="Success rate"
                    sort={sort}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="avgDurationMs"
                    label="Avg duration"
                    sort={sort}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="avgCostUsd"
                    label="Avg cost"
                    sort={sort}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="avgTokens"
                    label="Avg tokens"
                    sort={sort}
                    onSort={handleSort}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((metric) => {
                  const planName = planMap.get(metric.planId);
                  const rate = getSuccessRate(metric);

                  return (
                    <TableRow key={metric.id}>
                      <TableCell>
                        <span
                          className="max-w-xs truncate font-medium text-sm"
                          title={metric.title}
                        >
                          {truncateTitle(metric.title)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className="font-mono text-xs text-muted-foreground"
                          title={planName ?? metric.planId}
                        >
                          {planName ?? metric.planId}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {metric.totalExecutions.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        <span className={successRateColor(rate)}>
                          {metric.totalExecutions === 0 ? "—" : `${rate.toFixed(1)}%`}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {formatAvgDuration(metric.avgDurationMs)}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {formatAvgCost(metric.avgCostUsd)}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {formatTokens(metric.avgTokens)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

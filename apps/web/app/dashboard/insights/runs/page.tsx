"use client";

import type { Plan, Run } from "@conductor/db";
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
import { apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";
import { formatCostUsd, formatDuration, formatRelativeTime } from "@/lib/ui/format";

import { RunStatusBadge } from "../_components/run-status-badge";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface RunsResponse {
  runs: Run[];
}

interface PlansResponse {
  plans: Plan[];
}

type SortColumn = "status" | "plan" | "started_at" | "duration" | "cost" | "tokens" | null;

type SortDirection = "asc" | "desc";

interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getDurationMs(run: Run): number | null {
  if (run.started_at === null || run.finished_at === null) return null;
  const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

function formatDurationCell(run: Run): string {
  const ms = getDurationMs(run);
  if (ms === null) return "—";
  return formatDuration(ms);
}

function formatCostCell(cost: number): string {
  if (cost === 0) return "—";
  return formatCostUsd(cost);
}

function truncateName(name: string, maxLen = 32): string {
  if (name.length <= maxLen) return name;
  return `${name.slice(0, maxLen - 1)}…`;
}

// ─── Sort utils ────────────────────────────────────────────────────────────────

function getRunSortValue(
  run: Run,
  column: SortColumn,
  planMap: Map<string, string>,
): string | number | null {
  switch (column) {
    case "status":
      return run.status;
    case "plan":
      return planMap.get(run.plan_id) ?? run.plan_id;
    case "started_at":
      return run.started_at ? new Date(run.started_at).getTime() : 0;
    case "duration":
      return getDurationMs(run) ?? -1;
    case "cost":
      return run.total_cost_usd;
    case "tokens":
      return run.total_input_tokens + run.total_output_tokens;
    default:
      return null;
  }
}

function sortRuns(runs: Run[], sort: SortState, planMap: Map<string, string>): Run[] {
  if (sort.column === null) return runs;

  return [...runs].sort((a, b) => {
    const va = getRunSortValue(a, sort.column, planMap);
    const vb = getRunSortValue(b, sort.column, planMap);

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

const PAGE_SIZE = 50;

export default function RunsInsightsPage() {
  const [sort, setSort] = useState<SortState>({ column: "started_at", direction: "desc" });
  const [page, setPage] = useState(0);

  const runsQuery = useQuery<RunsResponse>({
    queryKey: qk.runs.list({ limit: 200 }),
    queryFn: ({ signal }) => apiClient.get<RunsResponse>("/api/runs?limit=200", { signal }),
    staleTime: 30_000,
  });

  const plansQuery = useQuery<PlansResponse>({
    queryKey: qk.plans.list({ limit: 200 }),
    queryFn: ({ signal }) => apiClient.get<PlansResponse>("/api/plans?limit=200", { signal }),
    staleTime: 60_000,
  });

  const isLoading = runsQuery.isLoading || plansQuery.isLoading;
  const isError = runsQuery.isError || plansQuery.isError;

  // Build plan id → name map
  const planMap = new Map<string, string>();
  for (const plan of plansQuery.data?.plans ?? []) {
    planMap.set(plan.id, plan.name);
  }

  const allRuns = runsQuery.data?.runs ?? [];
  const sorted = sortRuns(allRuns, sort, planMap);

  // Paginate
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRuns = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function handleSort(col: SortColumn) {
    setSort((prev) => {
      if (prev.column !== col) return { column: col, direction: "asc" };
      if (prev.direction === "asc") return { column: col, direction: "desc" };
      // cycle: asc → desc → off (back to default)
      return { column: "started_at", direction: "desc" };
    });
    setPage(0);
  }

  return (
    <div className="mx-auto max-w-7xl flex flex-col gap-6 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Run Analytics</h1>
          {!isLoading && (
            <p className="mt-1 text-sm text-muted-foreground">
              {allRuns.length} run{allRuns.length !== 1 ? "s" : ""} total
            </p>
          )}
        </div>
      </div>

      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load run data. Refresh to try again.
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">All runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : allRuns.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No runs found.</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader
                      column="status"
                      label="Status"
                      sort={sort}
                      onSort={handleSort}
                    />
                    <SortableHeader column="plan" label="Plan" sort={sort} onSort={handleSort} />
                    <SortableHeader
                      column="started_at"
                      label="Started"
                      sort={sort}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      column="duration"
                      label="Duration"
                      sort={sort}
                      onSort={handleSort}
                    />
                    <SortableHeader column="cost" label="Cost" sort={sort} onSort={handleSort} />
                    <SortableHeader
                      column="tokens"
                      label="Tokens"
                      sort={sort}
                      onSort={handleSort}
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRuns.map((run) => {
                    const planName = planMap.get(run.plan_id);
                    const totalTokens = run.total_input_tokens + run.total_output_tokens;

                    return (
                      <TableRow key={run.id}>
                        <TableCell>
                          <RunStatusBadge status={run.status} />
                        </TableCell>
                        <TableCell>
                          <span
                            className="font-mono text-xs text-muted-foreground"
                            title={planName ?? run.plan_id}
                          >
                            {planName ? truncateName(planName) : truncateName(run.plan_id, 16)}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {run.started_at
                            ? formatRelativeTime(run.started_at)
                            : formatRelativeTime(run.created_at)}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          {formatDurationCell(run)}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          {formatCostCell(run.total_cost_usd)}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums text-muted-foreground">
                          {totalTokens > 0 ? totalTokens.toLocaleString() : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t px-4 py-3">
                  <span className="text-xs text-muted-foreground">
                    Page {page + 1} of {totalPages} ({allRuns.length} total)
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                      className="rounded-md border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => p + 1)}
                      className="rounded-md border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

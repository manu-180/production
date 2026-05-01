"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRunsList } from "@/hooks/use-runs-list";
import { formatCostUsd, formatDuration, formatRelativeTime } from "@/lib/ui/format";
import { cn } from "@/lib/utils";
import type { Run } from "@conductor/db";
import { ArrowLeftIcon, PlayIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  completed: "text-emerald-500 bg-emerald-500/10",
  failed: "text-red-500 bg-red-500/10",
  running: "text-sky-500 bg-sky-500/10",
  queued: "text-muted-foreground bg-muted",
  paused: "text-amber-500 bg-amber-500/10",
  cancelled: "text-muted-foreground bg-muted",
};

function StatusBadge({ status }: { status: string }) {
  const colorClass = STATUS_COLORS[status] ?? "text-muted-foreground bg-muted";
  const label = status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <Badge
      variant="outline"
      className={cn("border-transparent font-medium capitalize", colorClass)}
      aria-label={`Run status: ${label}`}
    >
      {label}
    </Badge>
  );
}

// ─── Duration helper ──────────────────────────────────────────────────────────

function computeDuration(run: Run): string {
  if (!run.started_at || !run.finished_at) return "—";
  const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
  if (ms < 0) return "—";
  return formatDuration(ms);
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows are static placeholders, never reordered
        <TableRow key={i} aria-hidden="true">
          <TableCell>
            <Skeleton className="h-5 w-20 rounded-full" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-24" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-12" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-14" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-40" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-7 w-14 rounded-md" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlanRunsPage() {
  const params = useParams<{ id: string }>();
  const planId = params.id;
  const router = useRouter();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const query = useRunsList({ planId });

  const allRuns = query.data?.pages.flatMap((p) => p.runs) ?? [];
  const isInitialLoading = query.isLoading;
  const isEmpty = !isInitialLoading && allRuns.length === 0;

  // Infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [query]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      {/* Page header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-xl font-semibold tracking-tight">Run History</h1>
          <p className="text-sm text-muted-foreground">All runs for this plan</p>
        </div>
        <Button
          render={<Link href={`/dashboard/plans/${planId}`} />}
          variant="outline"
          size="sm"
          aria-label="Back to plan editor"
        >
          <ArrowLeftIcon className="mr-1.5 size-4" aria-hidden="true" />
          Back to Plan
        </Button>
      </header>

      {/* Error state */}
      {query.isError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Failed to load runs.{" "}
          <button
            type="button"
            onClick={() => query.refetch()}
            className="underline underline-offset-2 hover:no-underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <PlayIcon className="size-6 text-muted-foreground" aria-hidden="true" />
          </div>
          <div>
            <p className="font-medium text-foreground">No runs yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Launch your first run from the plan editor.
            </p>
          </div>
          <Button render={<Link href={`/dashboard/plans/${planId}`} />} size="sm">
            Open Plan Editor
          </Button>
        </div>
      )}

      {/* Runs table */}
      {(isInitialLoading || allRuns.length > 0) && (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table aria-label="Plan run history">
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-36">Started</TableHead>
                <TableHead className="w-24">Duration</TableHead>
                <TableHead className="w-24">Cost</TableHead>
                <TableHead>Working Dir</TableHead>
                <TableHead className="w-20 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isInitialLoading ? (
                <SkeletonRows count={5} />
              ) : (
                allRuns.map((run) => (
                  <TableRow
                    key={run.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/dashboard/runs/${run.id}`)}
                    aria-label={`View run from ${formatRelativeTime(run.created_at)}, status: ${run.status}`}
                  >
                    <TableCell>
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      <time dateTime={run.created_at}>{formatRelativeTime(run.created_at)}</time>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {computeDuration(run)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {run.total_cost_usd != null ? formatCostUsd(run.total_cost_usd) : "—"}
                    </TableCell>
                    <TableCell
                      className="max-w-[200px] truncate font-mono text-xs text-muted-foreground"
                      title={run.working_dir}
                    >
                      {run.working_dir}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="ghost"
                        render={<Link href={`/dashboard/runs/${run.id}`} />}
                        aria-label={`View run details for run started ${formatRelativeTime(run.created_at)}`}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}

              {/* Inline load-more skeletons */}
              {query.isFetchingNextPage && <SkeletonRows count={3} />}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-1" aria-hidden="true" />

      {/* Run count summary */}
      {!isInitialLoading && allRuns.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          {query.hasNextPage
            ? `Showing ${allRuns.length} runs — scroll for more`
            : `${allRuns.length} run${allRuns.length !== 1 ? "s" : ""} total`}
        </p>
      )}
    </div>
  );
}

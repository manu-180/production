"use client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCostUsd, formatDuration, formatRelativeTime } from "@/lib/ui/format";
import type { RunStatus } from "@/lib/ui/status";
import type { Run } from "@conductor/db";
import { ChevronRightIcon, FileTextIcon } from "lucide-react";
import Link from "next/link";
import { RunStatusBadge } from "../runs/_components/run-status-badge";

interface Props {
  runs: Run[];
  isLoading?: boolean;
}

function durationFromRun(r: Run): string {
  if (r.started_at === null) return "—";
  const end = r.finished_at !== null ? new Date(r.finished_at).getTime() : Date.now();
  return formatDuration(end - new Date(r.started_at).getTime());
}

export function RecentRunsList({ runs, isLoading }: Props) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="divide-y divide-border p-0">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <Skeleton className="size-8 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (runs.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <FileTextIcon className="size-8 text-muted-foreground" />
          <div className="text-sm font-medium">Todavía no hay ejecuciones</div>
          <p className="max-w-sm text-xs text-muted-foreground">
            Creá un plan y ejecutalo por primera vez para empezar a ver actividad en vivo.
          </p>
          <Link
            href="/dashboard/plans/new"
            className="text-xs font-medium text-primary hover:underline"
          >
            Creá tu primer plan →
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="divide-y divide-border p-0">
        {runs.map((r) => (
          <Link
            key={r.id}
            href={`/dashboard/runs/${r.id}`}
            className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/40"
          >
            <RunStatusBadge status={r.status as RunStatus} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{r.working_dir}</div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{r.id.slice(0, 8)}</span>
                <span>·</span>
                <span>{formatRelativeTime(r.created_at)}</span>
                <span>·</span>
                <span>{durationFromRun(r)}</span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">{formatCostUsd(r.total_cost_usd)}</div>
            <ChevronRightIcon className="size-3 text-muted-foreground" />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

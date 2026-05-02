"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatCostUsd, formatDuration } from "@/lib/ui/format";
import { type RunStatus, TONE_CLASSES, runStatusInfo } from "@/lib/ui/status";
import { cn } from "@/lib/utils";
import type { Run } from "@conductor/db";
import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { RunStatusBadge } from "../runs/_components/run-status-badge";

interface Props {
  run: Run;
  totalPrompts?: number;
}

function nowMs(run: Run): number {
  if (run.started_at === null) return 0;
  const end = run.finished_at !== null ? new Date(run.finished_at).getTime() : Date.now();
  return Math.max(0, end - new Date(run.started_at).getTime());
}

export function ActiveRunCard({ run, totalPrompts }: Props) {
  const status = run.status as RunStatus;
  const info = runStatusInfo(status);
  const tone = TONE_CLASSES[info.tone];
  const current = run.current_prompt_index ?? 0;
  const pct =
    totalPrompts && totalPrompts > 0
      ? Math.min(100, Math.round((current / totalPrompts) * 100))
      : 0;

  return (
    <Card className={cn("overflow-hidden border", tone.border)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <RunStatusBadge status={status} />
              <span className="font-mono text-xs text-muted-foreground truncate">
                {run.id.slice(0, 8)}
              </span>
            </div>
            <div className="mt-2 truncate text-sm font-medium">{run.working_dir}</div>
            <div className="mt-3 space-y-1.5">
              <Progress value={pct} className="h-1.5" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {totalPrompts
                    ? `Prompt ${current + 1} de ${totalPrompts}`
                    : `Prompt ${current + 1}`}
                </span>
                <span>
                  {formatDuration(nowMs(run))} · {formatCostUsd(run.total_cost_usd)}
                </span>
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/dashboard/runs/${run.id}`} />}
            className="gap-1"
          >
            Ver
            <ChevronRightIcon className="size-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

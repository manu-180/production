"use client";
import { daysAgoIso, formatUsd } from "@/lib/ui/format";
import type { RunsDailyMetric } from "@conductor/core";

interface CostBreakdownProps {
  runsByDay: RunsDailyMetric[];
}

function sumCost(rows: RunsDailyMetric[]): number {
  return rows.reduce((acc, r) => acc + r.totalCostUsd, 0);
}

export function CostBreakdown({ runsByDay }: CostBreakdownProps) {
  const since7d = daysAgoIso(7);
  const since30d = daysAgoIso(30);

  const last7d = runsByDay.filter((r) => r.day >= since7d);
  const last30d = runsByDay.filter((r) => r.day >= since30d);

  const cost7d = sumCost(last7d);
  const cost30d = sumCost(last30d);

  return (
    <div className="flex gap-6">
      <div className="flex-1 rounded-lg border border-border bg-muted/30 p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Costo (7 días)
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight">{formatUsd(cost7d)}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">estimado</div>
      </div>
      <div className="flex-1 rounded-lg border border-border bg-muted/30 p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Costo (30 días)
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight">{formatUsd(cost30d)}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">estimado</div>
      </div>
    </div>
  );
}

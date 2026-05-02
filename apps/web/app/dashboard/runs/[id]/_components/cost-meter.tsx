"use client";
import { Card, CardContent } from "@/components/ui/card";
import type { RunDetailCache } from "@/lib/realtime/event-handlers";
import { formatCostUsd } from "@/lib/ui/format";

export function CostMeter({ run }: { run: RunDetailCache }) {
  const completed = run.executions.filter((e) => e.status === "succeeded").length;
  const total = run.executions.length;
  const remaining = total - completed;

  const estimated =
    completed > 0 && remaining > 0 ? (run.total_cost_usd / completed) * total : null;

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Costo
          </h3>
          <span className="font-mono text-lg font-semibold tracking-tight">
            {formatCostUsd(run.total_cost_usd)}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {completed} de {total} prompts completados
        </div>
        {estimated !== null && (
          <div className="text-[11px] text-muted-foreground">
            Total estimado: <span className="font-mono">{formatCostUsd(estimated)}</span>
          </div>
        )}

        <div className="mt-2 flex items-end gap-1">
          {run.executions.map((e, idx) => {
            const cost = e.cost_usd ?? 0;
            const max = Math.max(...run.executions.map((x) => x.cost_usd ?? 0), 0.0001);
            const h = Math.max(4, Math.round((cost / max) * 32));
            const tone =
              e.status === "failed"
                ? "bg-rose-500/70"
                : e.status === "succeeded"
                  ? "bg-emerald-500/70"
                  : "bg-muted-foreground/30";
            return (
              <div
                key={e.id}
                title={`#${idx + 1} — ${formatCostUsd(cost)}`}
                style={{ height: `${h}px` }}
                className={`w-1.5 rounded-t-sm ${tone}`}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

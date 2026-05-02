"use client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useGuardianFeed } from "@/hooks/use-guardian-feed";
import { cn } from "@/lib/utils";
import { ChevronRightIcon, ShieldIcon } from "lucide-react";
import Link from "next/link";

function truncate(s: string, n: number) {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function strategyTone(strategy: string): string {
  if (strategy === "llm") return "bg-violet-500/10 text-violet-500";
  if (strategy === "heuristic") return "bg-sky-500/10 text-sky-500";
  return "bg-muted text-muted-foreground";
}

export function GuardianFeedPanel({ runId }: { runId: string }) {
  const { data, isLoading } = useGuardianFeed(runId);

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ShieldIcon className="size-3.5" /> Guardián
          </h3>
          <Link
            href={`/dashboard/runs/${runId}/decisions`}
            className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
          >
            Todas las decisiones
            <ChevronRightIcon className="size-3" />
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-1.5">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : !data || data.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-muted-foreground">
            Sin intervenciones aún.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {data.slice(0, 6).map((d) => (
              <li
                key={d.id}
                className="rounded-md border border-border bg-muted/30 px-2 py-1.5 text-[11px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[9px] font-medium uppercase",
                      strategyTone(d.strategy),
                    )}
                  >
                    {d.strategy}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {(d.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="mt-1 truncate text-muted-foreground">
                  {truncate(d.question_detected, 80)}
                </div>
                <div className="mt-0.5 truncate text-foreground/90">→ {d.decision}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

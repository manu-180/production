"use client";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface KpiCardProps {
  label: string;
  value: string | number;
  delta?: string;
  icon?: LucideIcon;
  tone?: "neutral" | "info" | "success" | "warning";
  loading?: boolean;
}

const TONE_BG: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  neutral: "bg-muted/40 text-muted-foreground",
  info: "bg-sky-500/10 text-sky-500",
  success: "bg-emerald-500/10 text-emerald-500",
  warning: "bg-amber-500/10 text-amber-500",
};

export function KpiCard({
  label,
  value,
  delta,
  icon: Icon,
  tone = "neutral",
  loading,
}: KpiCardProps) {
  if (loading) {
    return (
      <Card>
        <CardContent className="flex h-24 flex-col justify-between gap-2 p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-16" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="mt-1.5 truncate font-heading text-2xl font-semibold tracking-tight">
            {value}
          </div>
          {delta && (
            <div className="mt-0.5 text-xs text-muted-foreground">{delta}</div>
          )}
        </div>
        {Icon && (
          <div className={cn("rounded-lg p-2", TONE_BG[tone])}>
            <Icon className="size-4" aria-hidden="true" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

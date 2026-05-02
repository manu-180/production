"use client";

import { cn } from "@/lib/utils";

export type RunStatus = "completed" | "failed" | "cancelled" | "running" | "queued" | "paused";

const STATUS_STYLES: Record<RunStatus, string> = {
  completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-600 dark:text-red-400",
  cancelled: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  running: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  queued: "bg-neutral-500/10 text-neutral-600 dark:text-neutral-400",
  paused: "bg-neutral-500/10 text-neutral-600 dark:text-neutral-400",
};

const STATUS_LABEL: Record<RunStatus, string> = {
  completed: "Completada",
  failed: "Fallida",
  cancelled: "Cancelada",
  running: "En ejecución",
  queued: "En cola",
  paused: "Pausada",
};

interface RunStatusBadgeProps {
  status: string;
  className?: string;
}

export function RunStatusBadge({ status, className }: RunStatusBadgeProps) {
  const key = status as RunStatus;
  const styles = STATUS_STYLES[key] ?? "bg-neutral-500/10 text-neutral-600 dark:text-neutral-400";
  const label = STATUS_LABEL[key] ?? status;

  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-xs font-medium",
        styles,
        className,
      )}
    >
      {label}
    </span>
  );
}

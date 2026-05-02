"use client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSystemHealth } from "@/hooks/use-system-health";
import { cn } from "@/lib/utils";

interface DotProps {
  label: string;
  tone: "ok" | "warn" | "bad" | "muted";
}

function StatusDot({ label, tone }: DotProps) {
  const color =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-500"
        : tone === "bad"
          ? "bg-rose-500"
          : "bg-muted-foreground/40";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <span aria-hidden="true" className={cn("inline-block size-1.5 rounded-full", color)} />
            <span>{label}</span>
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function SystemStatusIndicator() {
  const { data, isLoading } = useSystemHealth();

  const dbTone = isLoading ? "muted" : data?.db === "ok" ? "ok" : "bad";
  const workerTone = isLoading
    ? "muted"
    : data?.worker === "ok"
      ? "ok"
      : data?.worker === "offline"
        ? "warn"
        : "bad";

  return (
    <div className="flex items-center gap-3 px-2">
      <StatusDot label="Worker" tone={workerTone} />
      <StatusDot label="BD" tone={dbTone} />
    </div>
  );
}

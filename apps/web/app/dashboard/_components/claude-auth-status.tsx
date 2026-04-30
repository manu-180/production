"use client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSystemHealth } from "@/hooks/use-system-health";
import { cn } from "@/lib/utils";

export function ClaudeAuthStatus() {
  const { data, isLoading } = useSystemHealth();
  const installed = data?.claudeCli.installed ?? false;
  const version = data?.claudeCli.version;

  const tone = isLoading
    ? "bg-muted-foreground/40"
    : installed
      ? "bg-emerald-500"
      : "bg-rose-500";

  const label = isLoading
    ? "Checking Claude CLI…"
    : installed
      ? `Claude CLI ${version ?? "ready"}`
      : "Claude CLI not installed";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button type="button" aria-label={label} className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "inline-block size-2 rounded-full",
                tone,
                installed && !isLoading && "shadow-[0_0_8px] shadow-emerald-400/60",
              )}
            />
            <span className="truncate">Claude</span>
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

"use client";
import { Badge } from "@/components/ui/badge";
import { type RunStatus, runStatusInfo, TONE_CLASSES } from "@/lib/ui/status";
import { cn } from "@/lib/utils";

export function RunStatusBadge({
  status,
  className,
}: {
  status: RunStatus;
  className?: string;
}) {
  const info = runStatusInfo(status);
  const tone = TONE_CLASSES[info.tone];
  return (
    <Badge
      className={cn(
        "gap-1.5 border font-medium",
        tone.bg,
        tone.text,
        tone.border,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block size-1.5 rounded-full",
          tone.dot,
          info.pulse && "animate-pulse",
        )}
      />
      {info.label}
    </Badge>
  );
}

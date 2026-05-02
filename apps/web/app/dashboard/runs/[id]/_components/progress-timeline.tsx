"use client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RunDetailCache } from "@/lib/realtime/event-handlers";
import { type ExecutionStatus, TONE_CLASSES, executionStatusInfo } from "@/lib/ui/status";
import { cn } from "@/lib/utils";
import { CheckIcon, MinusIcon, PauseIcon, XIcon } from "lucide-react";

function NodeIcon({ status }: { status: ExecutionStatus }) {
  if (status === "succeeded") return <CheckIcon className="size-3.5" />;
  if (status === "failed") return <XIcon className="size-3.5" />;
  if (status === "skipped" || status === "rolled_back") return <MinusIcon className="size-3.5" />;
  if (status === "awaiting_approval") return <PauseIcon className="size-3.5" />;
  return null;
}

export function ProgressTimeline({
  run,
  onSelectExecution,
  selectedExecutionId,
}: {
  run: RunDetailCache;
  onSelectExecution: (id: string) => void;
  selectedExecutionId?: string | null;
}) {
  if (run.executions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
        Esperando que comience el primer prompt…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {run.executions.map((exec, idx) => {
          const status = (exec.status ?? "pending") as ExecutionStatus;
          const info = executionStatusInfo(status);
          const tone = TONE_CLASSES[info.tone];
          const title = exec.prompts?.title ?? exec.prompts?.filename ?? `Prompt ${idx + 1}`;
          const isSelected = exec.id === selectedExecutionId;

          return (
            <div key={exec.id} className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => onSelectExecution(exec.id)}
                      aria-label={`${title} — ${info.label}`}
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                        tone.border,
                        tone.bg,
                        tone.text,
                        info.pulse && "animate-pulse",
                        isSelected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                      )}
                    >
                      <NodeIcon status={status} />
                      {status === "pending" && (
                        <span className="text-[10px] font-mono">{idx + 1}</span>
                      )}
                      {status === "running" && (
                        <span className="text-[10px] font-mono">{idx + 1}</span>
                      )}
                    </button>
                  }
                />
                <TooltipContent side="bottom">
                  <div className="text-xs font-medium">{title}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{info.label}</div>
                </TooltipContent>
              </Tooltip>
              {idx < run.executions.length - 1 && (
                <div className="h-0.5 w-6 rounded-full bg-border" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

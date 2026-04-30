"use client";
import { PauseIcon, PlayIcon, RotateCcwIcon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRunActions } from "@/hooks/use-run-actions";
import type { RunStatus } from "@/lib/ui/status";

export function ControlButtons({
  runId,
  status,
}: {
  runId: string;
  status: RunStatus;
}) {
  const actions = useRunActions(runId);

  const canPause = status === "running";
  const canResume = status === "paused";
  const canCancel = status === "running" || status === "paused" || status === "queued";
  const canRetry = status === "failed" || status === "cancelled";

  return (
    <div className="flex items-center gap-2">
      {canPause && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={actions.pause.isPending}
          onClick={() => actions.pause.mutate()}
        >
          <PauseIcon className="size-3.5" /> Pause
        </Button>
      )}
      {canResume && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={actions.resume.isPending}
          onClick={() => actions.resume.mutate()}
        >
          <PlayIcon className="size-3.5" /> Resume
        </Button>
      )}
      {canCancel && (
        <Button
          size="sm"
          variant="destructive"
          className="gap-1.5"
          disabled={actions.cancel.isPending}
          onClick={() => {
            if (window.confirm("Cancel this run? Any in-flight prompt will stop after the current step.")) {
              actions.cancel.mutate();
            }
          }}
        >
          <XCircleIcon className="size-3.5" /> Cancel
        </Button>
      )}
      {canRetry && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={actions.retry.isPending}
          onClick={() => actions.retry.mutate()}
        >
          <RotateCcwIcon className="size-3.5" /> Retry
        </Button>
      )}
    </div>
  );
}

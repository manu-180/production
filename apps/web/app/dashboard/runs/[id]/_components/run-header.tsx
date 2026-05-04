"use client";
import { Button } from "@/components/ui/button";
import type { RunDetailCache } from "@/lib/realtime/event-handlers";
import type { RunStatus } from "@/lib/ui/status";
import { ArrowLeftIcon, CopyIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { RunStatusBadge } from "../../_components/run-status-badge";
import { ControlButtons } from "./control-buttons";
import { RunDuration } from "./run-duration";

export function RunHeader({ run }: { run: RunDetailCache }) {
  const status = run.status as RunStatus;
  const planName = run.plan?.name ?? "Plan sin título";

  async function copyId() {
    try {
      await navigator.clipboard.writeText(run.id);
      toast.success("ID de ejecución copiado");
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  async function copyDir() {
    try {
      await navigator.clipboard.writeText(run.working_dir);
      toast.success("Directorio de trabajo copiado");
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Button
          variant="ghost"
          size="sm"
          render={<Link href="/dashboard/runs" />}
          nativeButton={false}
          className="-ml-2 gap-1.5"
        >
          <ArrowLeftIcon className="size-3.5" /> Volver a ejecuciones
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
              {planName}
            </h1>
            <RunStatusBadge status={status} />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={copyId}
              className="group inline-flex items-center gap-1 font-mono hover:text-foreground"
              aria-label="Copiar id de ejecución"
            >
              {run.id.slice(0, 8)}…
              <CopyIcon className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
            <span aria-hidden="true">·</span>
            <span>
              <RunDuration
                startedAt={run.started_at}
                finishedAt={run.finished_at}
                isRunning={status === "running"}
              />
            </span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={copyDir}
              className="group inline-flex max-w-[420px] items-center gap-1 truncate hover:text-foreground"
              aria-label="Copiar directorio de trabajo"
            >
              <span className="truncate">{run.working_dir}</span>
              <CopyIcon className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </div>
        </div>

        <ControlButtons
          runId={run.id}
          status={status}
          totalPrompts={run.executions.length}
          lastSucceededPromptIndex={run.last_succeeded_prompt_index ?? null}
          failedAtIndex={
            run.executions.find((e) => e.status === "failed")?.prompts?.order_index ?? null
          }
        />
      </div>
    </header>
  );
}

"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatCostUsd, formatDuration, formatTokens } from "@/lib/ui/format";
import { type ExecutionStatus, TONE_CLASSES, executionStatusInfo } from "@/lib/ui/status";
import { cn } from "@/lib/utils";
import type { PromptExecution } from "@conductor/db";
import { motion } from "framer-motion";
import { ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon, FileDiffIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LiveLogStream } from "./live-log-stream";

interface PromptExecutionView extends PromptExecution {
  prompts?: { order_index: number; title: string | null; filename: string | null } | null;
}

export function PromptCard({
  runId,
  execution,
  index,
  defaultOpen,
  active,
}: {
  runId: string;
  execution: PromptExecutionView;
  index: number;
  defaultOpen?: boolean;
  active?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const status = (execution.status ?? "pending") as ExecutionStatus;
  const info = executionStatusInfo(status);
  const tone = TONE_CLASSES[info.tone];

  const title = execution.prompts?.title ?? execution.prompts?.filename ?? `Prompt ${index + 1}`;
  const isRunning = status === "running";

  const duration =
    execution.started_at !== null && execution.finished_at !== null
      ? formatDuration(
          new Date(execution.finished_at).getTime() - new Date(execution.started_at).getTime(),
        )
      : execution.duration_ms !== null
        ? formatDuration(execution.duration_ms)
        : null;

  const totalTokens = execution.input_tokens + execution.output_tokens + execution.cache_tokens;

  return (
    <Card
      className={cn(
        "overflow-hidden transition-all",
        active && "ring-2 ring-ring ring-offset-2 ring-offset-background",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40",
          info.pulse && "animate-pulse-slow",
        )}
        aria-expanded={open}
      >
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-mono",
            tone.bg,
            tone.text,
            tone.border,
          )}
        >
          {index + 1}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{title}</span>
            <span className={cn("text-[10px] uppercase tracking-wide", tone.text)}>
              {info.label}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {duration && <span>⏱ {duration}</span>}
            {totalTokens > 0 && <span>🔣 {formatTokens(totalTokens)}</span>}
            {execution.cost_usd > 0 && <span>💵 {formatCostUsd(execution.cost_usd)}</span>}
            {execution.attempt > 0 && <span>↻ intento {execution.attempt + 1}</span>}
          </div>
        </div>

        {open ? (
          <ChevronUpIcon className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          transition={{ duration: 0.18 }}
        >
          <CardContent className="space-y-4 border-t border-border bg-muted/10 p-4">
            {status === "failed" && execution.error_message && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-400">
                <div className="font-medium">Fallo</div>
                <div className="mt-0.5 font-mono">{execution.error_code ?? "error"}</div>
                <div className="mt-1 whitespace-pre-wrap">{execution.error_message}</div>
              </div>
            )}

            {status === "awaiting_approval" && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-500">
                Esperando tu aprobación — revisá el modal que bloquea esta vista.
              </div>
            )}

            {(status === "running" || status === "succeeded" || status === "failed") && (
              <LiveLogStream runId={runId} promptExecutionId={execution.id} height={300} />
            )}

            <div className="flex flex-wrap items-center gap-2">
              {execution.checkpoint_sha && (
                <Button
                  size="sm"
                  variant="outline"
                  render={<Link href={`/dashboard/runs/${runId}/diff/${execution.prompt_id}`} />}
                  className="gap-1.5"
                >
                  <FileDiffIcon className="size-3.5" /> Ver diferencias
                </Button>
              )}
              {execution.checkpoint_sha && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {execution.checkpoint_sha.slice(0, 12)}
                </span>
              )}
              {execution.claude_session_id && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  sesión {execution.claude_session_id.slice(0, 12)}
                </span>
              )}
              <Link
                href={`/dashboard/runs/${runId}/decisions`}
                className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
              >
                Decisiones
                <ExternalLinkIcon className="size-3" />
              </Link>
            </div>
            {!isRunning && status !== "succeeded" && status !== "failed" && (
              <p className="text-center text-[11px] text-muted-foreground">
                Los registros aparecerán cuando este prompt comience.
              </p>
            )}
          </CardContent>
        </motion.div>
      )}
    </Card>
  );
}

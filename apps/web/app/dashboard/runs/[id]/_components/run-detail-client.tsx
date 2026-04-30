"use client";
import { useEffect, useState } from "react";
import { useRunDetail } from "@/hooks/use-run-detail";
import { useRunRealtime } from "@/hooks/use-run-realtime";
import type { RunStatus } from "@/lib/ui/status";
import { ApprovalModal } from "./approval-modal";
import { CompletionConfetti } from "./completion-confetti";
import { CostMeter } from "./cost-meter";
import { GuardianFeedPanel } from "./guardian-feed-panel";
import { ProgressTimeline } from "./progress-timeline";
import { PromptCard } from "./prompt-card";
import { RunHeader } from "./run-header";
import { SystemHealthPanel } from "./system-health-panel";
import { TokenMeter } from "./token-meter";

export function RunDetailClient({ runId }: { runId: string }) {
  const { isLive } = useRunRealtime(runId);
  const { data: run, isLoading, isError } = useRunDetail(runId);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);

  // Auto-select the running execution if none is selected.
  useEffect(() => {
    if (!run || selectedExecutionId !== null) return;
    const running = run.executions.find((e) => e.status === "running" || e.status === "awaiting_approval");
    if (running) {
      setSelectedExecutionId(running.id);
      return;
    }
    const first = run.executions[0];
    if (first) setSelectedExecutionId(first.id);
  }, [run, selectedExecutionId]);

  if (isLoading) {
    return (
      <div className="mx-auto flex h-64 max-w-7xl items-center justify-center text-sm text-muted-foreground">
        Loading run…
      </div>
    );
  }

  if (isError || !run) {
    return (
      <div className="mx-auto flex h-64 max-w-7xl items-center justify-center text-sm text-rose-500">
        Failed to load run.
      </div>
    );
  }

  const totals = run.executions.reduce(
    (acc, e) => ({
      input: acc.input + (e.input_tokens ?? 0),
      output: acc.output + (e.output_tokens ?? 0),
      cache: acc.cache + (e.cache_tokens ?? 0),
    }),
    { input: 0, output: 0, cache: 0 },
  );

  return (
    <>
      <CompletionConfetti runId={runId} />
      <ApprovalModal run={run} />

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <RunHeader run={run} />

        <ProgressTimeline
          run={run}
          selectedExecutionId={selectedExecutionId}
          onSelectExecution={setSelectedExecutionId}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section aria-label="Prompts" className="space-y-3 lg:col-span-2">
            {run.executions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No prompt executions yet — once the worker picks up this run, prompts will appear here.
              </div>
            ) : (
              run.executions.map((exec, idx) => (
                <PromptCard
                  key={exec.id}
                  runId={runId}
                  execution={exec}
                  index={idx}
                  active={exec.id === selectedExecutionId}
                  defaultOpen={
                    exec.id === selectedExecutionId ||
                    exec.status === "running" ||
                    exec.status === "awaiting_approval"
                  }
                />
              ))
            )}
          </section>

          <aside className="space-y-3 lg:col-span-1">
            <TokenMeter
              inputTokens={Math.max(run.total_input_tokens, totals.input)}
              outputTokens={Math.max(run.total_output_tokens, totals.output)}
              cacheTokens={Math.max(run.total_cache_tokens, totals.cache)}
            />
            <CostMeter run={run} />
            <GuardianFeedPanel runId={runId} />
            <SystemHealthPanel isLive={isLive} />
          </aside>
        </div>
      </div>
    </>
  );
}

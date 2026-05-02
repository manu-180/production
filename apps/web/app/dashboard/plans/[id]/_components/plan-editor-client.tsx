"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { usePlanDetail } from "@/hooks/use-plan-detail";
import type { Prompt } from "@conductor/db";
import { useCallback, useEffect, useState } from "react";
import { LintPanel } from "./lint-panel";
import { PlanHeader } from "./plan-header";
import { PromptEditor } from "./prompt-editor";
import { PromptList } from "./prompt-list";
import { RunLauncherButton } from "./run-launcher";

interface PlanEditorClientProps {
  planId: string;
}

function EmptyPromptState() {
  return (
    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border">
      <div className="text-center">
        <p className="text-sm font-medium text-muted-foreground">Ningún prompt seleccionado</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Seleccioná un prompt de la lista o agregá uno nuevo
        </p>
      </div>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-8rem)]">
      <div className="flex items-start justify-between border-b border-border pb-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">
        <div className="col-span-3 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items are static, never reordered
            <Skeleton key={`editor-skeleton-${i}`} className="h-10 w-full rounded-lg" />
          ))}
        </div>
        <div className="col-span-6">
          <Skeleton className="h-full w-full rounded-xl" />
        </div>
        <div className="col-span-3 space-y-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function PlanEditorClient({ planId }: PlanEditorClientProps) {
  const { data: plan, isLoading, isError } = usePlanDetail(planId);

  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);

  // Auto-select first prompt when data loads
  useEffect(() => {
    if (plan && plan.prompts.length > 0 && selectedPromptId === null) {
      const first = plan.prompts[0];
      if (first) setSelectedPromptId(first.id);
    }
  }, [plan, selectedPromptId]);

  // Deselect if the selected prompt was deleted
  useEffect(() => {
    if (!plan || selectedPromptId === null) return;
    const exists = plan.prompts.some((p) => p.id === selectedPromptId);
    if (!exists) {
      setSelectedPromptId(plan.prompts[0]?.id ?? null);
    }
  }, [plan, selectedPromptId]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isMeta = e.metaKey || e.ctrlKey;
    if (isMeta && e.key === "s") {
      e.preventDefault();
      // Force-save: the PromptEditor auto-saves on debounce.
      // Here we just dispatch a custom event that PromptEditor listens to.
      window.dispatchEvent(new CustomEvent("conductor:force-save"));
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (isLoading) return <EditorSkeleton />;

  if (isError || !plan) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-border">
        <p className="text-sm text-rose-500">
          Error al cargar el plan. Por favor, recargá la página.
        </p>
      </div>
    );
  }

  const selectedPrompt: Prompt | undefined = plan.prompts.find((p) => p.id === selectedPromptId);

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-8rem)]">
      <PlanHeader plan={plan} />

      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">
        {/* Left rail: prompt list */}
        <div className="col-span-3 overflow-y-auto">
          <PromptList
            planId={planId}
            prompts={plan.prompts}
            selectedId={selectedPromptId}
            onSelect={setSelectedPromptId}
          />
        </div>

        {/* Center: prompt editor */}
        <div className="col-span-6 overflow-y-auto">
          {selectedPromptId && selectedPrompt ? (
            <PromptEditor
              key={selectedPrompt.id}
              prompt={selectedPrompt}
              planId={planId}
              allPrompts={plan.prompts}
            />
          ) : (
            <EmptyPromptState />
          )}
        </div>

        {/* Right rail: lint + run */}
        <div className="col-span-3 overflow-y-auto flex flex-col gap-4">
          <LintPanel
            content={selectedPrompt?.content ?? ""}
            frontmatter={(selectedPrompt?.frontmatter as Record<string, unknown>) ?? {}}
          />
          <RunLauncherButton
            planId={planId}
            promptCount={plan.prompts.length}
            defaultWorkingDir={plan.default_working_dir ?? ""}
          />
        </div>
      </div>
    </div>
  );
}

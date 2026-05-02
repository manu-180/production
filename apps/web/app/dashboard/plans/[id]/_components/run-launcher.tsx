"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useTriggerRun } from "@/hooks/use-plan-mutations";
import { FolderOpenIcon, Loader2Icon, PlayIcon, TerminalIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

// ─── Run Launcher Dialog ──────────────────────────────────────────────────────

interface RunLauncherDialogProps {
  planId: string;
  promptCount: number;
  open: boolean;
  onClose: () => void;
  defaultWorkingDir?: string;
}

interface DryRunResult {
  prompts: Array<{
    id: string;
    title: string | null;
    filename: string | null;
    order_index: number;
  }>;
  message?: string;
}

export function RunLauncherDialog({
  planId,
  promptCount,
  open,
  onClose,
  defaultWorkingDir = "",
}: RunLauncherDialogProps) {
  const router = useRouter();
  const triggerRun = useTriggerRun();

  const [workingDir, setWorkingDir] = useState(defaultWorkingDir);
  const [dryRun, setDryRun] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setWorkingDir(defaultWorkingDir);
      setDryRun(false);
      setDryRunResult(null);
    }
  }, [open, defaultWorkingDir]);

  function handleLaunch() {
    const trimmedDir = workingDir.trim();
    if (!trimmedDir) {
      toast.error("El directorio de trabajo es obligatorio");
      return;
    }

    triggerRun.mutate(
      { planId, workingDir: trimmedDir, dryRun },
      {
        onSuccess: (result) => {
          if (dryRun) {
            // Show dry run results
            setDryRunResult(result as unknown as DryRunResult);
          } else {
            onClose();
            toast.success("Ejecución iniciada");
            router.push(`/dashboard/runs/${result.runId}`);
          }
        },
        onError: (err) => {
          toast.error(err.message ?? "Error al iniciar la ejecución");
        },
      },
    );
  }

  const canLaunch = workingDir.trim().length > 0 && promptCount > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayIcon className="size-4" />
            Lanzar ejecución
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Working directory */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="run-working-dir" className="text-sm font-medium">
              Directorio de trabajo{" "}
              <span className="text-rose-500" aria-hidden>
                *
              </span>
            </Label>
            <div className="relative">
              <FolderOpenIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                id="run-working-dir"
                value={workingDir}
                onChange={(e) => {
                  setWorkingDir(e.target.value);
                  setDryRunResult(null);
                }}
                placeholder="/path/to/project"
                className="pl-9 font-mono text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canLaunch) handleLaunch();
                }}
              />
            </div>
          </div>

          {/* Dry run toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Ejecución de prueba</p>
              <p className="text-xs text-muted-foreground">
                Previsualizá qué prompts se ejecutarían sin correrlos realmente
              </p>
            </div>
            <Switch
              checked={dryRun}
              onCheckedChange={(v) => {
                setDryRun(v);
                setDryRunResult(null);
              }}
            />
          </div>

          {/* Summary */}
          {!dryRunResult && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <TerminalIcon className="size-4 text-muted-foreground" />
              <span>
                <span className="font-medium tabular-nums">{promptCount}</span> prompt
                {promptCount !== 1 ? "s" : ""} {dryRun ? "se previsualizarán" : "se ejecutarán"}
              </span>
            </div>
          )}

          {/* Dry run results */}
          {dryRunResult && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-emerald-600">
                Prueba completada — {dryRunResult.prompts?.length ?? 0} prompt
                {(dryRunResult.prompts?.length ?? 0) !== 1 ? "s" : ""} se ejecutarían
              </p>
              {dryRunResult.prompts && dryRunResult.prompts.length > 0 && (
                <ScrollArea className="max-h-40 rounded-md border border-border">
                  <div className="p-2 flex flex-col gap-1">
                    {dryRunResult.prompts.map((p, i) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-muted/50"
                      >
                        <span className="text-muted-foreground tabular-nums w-5 text-right shrink-0">
                          {i + 1}
                        </span>
                        <span className="truncate">{p.title ?? p.filename ?? "Sin título"}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={onClose}
              disabled={triggerRun.isPending}
            >
              Cancelar
            </Button>
            <Button
              className="flex-1 gap-2"
              onClick={handleLaunch}
              disabled={!canLaunch || triggerRun.isPending}
            >
              {triggerRun.isPending ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  {dryRun ? "Simulando..." : "Lanzando..."}
                </>
              ) : (
                <>
                  <PlayIcon className="size-4" />
                  {dryRun ? "Simular" : "Lanzar"}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Run Launcher Button ──────────────────────────────────────────────────────

interface RunLauncherButtonProps {
  planId: string;
  promptCount: number;
  defaultWorkingDir?: string;
}

export function RunLauncherButton({
  planId,
  promptCount,
  defaultWorkingDir = "",
}: RunLauncherButtonProps) {
  const [open, setOpen] = useState(false);

  // Cmd+Shift+R keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.shiftKey && e.key === "r") {
        e.preventDefault();
        if (promptCount > 0) setOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [promptCount]);

  return (
    <>
      <Button
        className="w-full gap-2"
        onClick={() => setOpen(true)}
        disabled={promptCount === 0}
        title={
          promptCount === 0 ? "Agregá prompts antes de lanzar" : "Lanzar ejecución (Ctrl+Shift+R)"
        }
      >
        <PlayIcon className="size-4" />
        Lanzar ejecución
      </Button>

      <RunLauncherDialog
        planId={planId}
        promptCount={promptCount}
        open={open}
        onClose={() => setOpen(false)}
        defaultWorkingDir={defaultWorkingDir}
      />
    </>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RotateCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface RetryModalProps {
  runId: string;
  totalPrompts: number;
  lastSucceededPromptIndex: number | null;
  failedAtIndex: number | null;
}

export function RetryModal({
  runId,
  totalPrompts,
  lastSucceededPromptIndex,
  failedAtIndex,
}: RetryModalProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const canResume = lastSucceededPromptIndex !== null;
  const resumeFromIndex = canResume ? lastSucceededPromptIndex + 1 : 0;
  const promptsCompleted = canResume ? lastSucceededPromptIndex + 1 : 0;
  const promptsRemaining = totalPrompts - promptsCompleted;

  const [mode, setMode] = useState<"resume" | "start">(canResume ? "resume" : "start");

  async function submit(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/retry?from=${mode}`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`,
        );
      }
      const data = await res.json();
      const newRunId = (data as { id?: string }).id;
      if (typeof newRunId !== "string") throw new Error("Respuesta sin id de nuevo run");
      setOpen(false);
      router.push(`/dashboard/runs/${newRunId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" className="gap-1.5" />}>
        <RotateCcwIcon className="size-3.5" /> Reintentar
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reintentar run</DialogTitle>
          <DialogDescription>
            {promptsCompleted} de {totalPrompts} prompts terminaron exitosamente
            {failedAtIndex !== null ? ` (falló en el prompt ${failedAtIndex + 1}).` : "."}
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-3 border-0 p-0 m-0">
          <legend className="sr-only">Modo de reintento</legend>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="retry-mode"
              value="resume"
              checked={mode === "resume"}
              disabled={!canResume}
              onChange={() => setMode("resume")}
              className="mt-0.5 accent-primary"
            />
            <div className="flex-1">
              <div className="font-medium text-sm">
                Continuar desde el prompt {resumeFromIndex + 1}
              </div>
              <div className="text-xs text-muted-foreground">
                {canResume
                  ? `Salta los ${promptsCompleted} prompts ya completados. Quedan ${promptsRemaining} por correr.`
                  : "No hay prompts completados — esta opción no está disponible."}
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="retry-mode"
              value="start"
              checked={mode === "start"}
              onChange={() => setMode("start")}
              className="mt-0.5 accent-primary"
            />
            <div className="flex-1">
              <div className="font-medium text-sm">Reiniciar plan completo</div>
              <div className="text-xs text-muted-foreground">
                Re-ejecuta los {totalPrompts} prompts desde cero.
              </div>
            </div>
          </label>
        </fieldset>

        {error !== null ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={loading} data-testid="retry-submit">
            {loading ? "Lanzando…" : "Reintentar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

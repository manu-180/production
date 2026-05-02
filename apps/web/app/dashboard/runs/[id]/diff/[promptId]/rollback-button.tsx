"use client";

import { Loader2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

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

interface RollbackButtonProps {
  runId: string;
  promptId: string;
  sha: string;
}

export function RollbackButton({ runId, promptId, sha }: RollbackButtonProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleRollback(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId, sha }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `La reversión falló (${res.status})`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Undo2 className="w-4 h-4 mr-2" />
        Revertir hasta acá
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Revertir este punto de control?</DialogTitle>
          <DialogDescription>
            Esto crea un nuevo commit de reversión en la rama actual que deshace los cambios del
            prompt <strong>{promptId}</strong> (<code className="text-xs">{sha.slice(0, 8)}</code>).
            Esta acción es destructiva en el sentido de que tu árbol de trabajo cambiará. Los
            conflictos pueden cancelar la reversión.
          </DialogDescription>
        </DialogHeader>
        {error !== null ? <p className="text-sm text-red-600">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleRollback} disabled={loading}>
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Undo2 className="w-4 h-4 mr-2" />
            )}
            Confirmar reversión
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

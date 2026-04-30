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
        setError(body.error ?? `Rollback failed (${res.status})`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Undo2 className="w-4 h-4 mr-2" />
        Rollback to here
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rollback this checkpoint?</DialogTitle>
          <DialogDescription>
            This creates a new revert commit on the current branch that undoes the changes from
            prompt <strong>{promptId}</strong> (<code className="text-xs">{sha.slice(0, 8)}</code>).
            This action is destructive in the sense that your working tree will change. Conflicts
            may abort the rollback.
          </DialogDescription>
        </DialogHeader>
        {error !== null ? <p className="text-sm text-red-600">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleRollback} disabled={loading}>
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Undo2 className="w-4 h-4 mr-2" />
            )}
            Confirm rollback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

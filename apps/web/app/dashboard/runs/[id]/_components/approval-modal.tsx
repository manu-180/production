"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useApprovePromptMutation,
  useRunActions,
  useSkipPromptMutation,
} from "@/hooks/use-run-actions";
import { useShortcut } from "@/hooks/use-keyboard-shortcuts";
import type { RunDetailCache } from "@/lib/realtime/event-handlers";

const Markdown = dynamic(
  () => import("react-markdown").then((m) => m.default),
  {
    ssr: false,
    loading: () => <div className="text-xs text-muted-foreground">Loading…</div>,
  },
);

function findAwaitingExecution(run: RunDetailCache) {
  return run.executions.find((e) => e.status === "awaiting_approval") ?? null;
}

export function ApprovalModal({ run }: { run: RunDetailCache }) {
  const exec = findAwaitingExecution(run);
  const open = exec !== null;
  const [shake, setShake] = useState(false);

  const approve = useApprovePromptMutation(run.id);
  const skip = useSkipPromptMutation(run.id);
  const actions = useRunActions(run.id);

  // Trigger a brief shake animation on Esc while the modal is open — base-ui's
  // `dismissible={false}` already blocks closing, but we surface the rejection.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setShake(true);
        setTimeout(() => setShake(false), 450);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  useShortcut(
    "mod+enter",
    () => {
      if (!exec) return;
      approve.mutate({ promptId: exec.prompt_id, decision: "approve" });
    },
    { allowInInput: true },
  );

  if (!exec) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          // forced decision — do not allow close, surface a shake
          setShake(true);
          setTimeout(() => setShake(false), 450);
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={`max-w-2xl bg-background/95 backdrop-blur-md ${shake ? "animate-shake" : ""}`}
      >
        <DialogHeader>
          <DialogTitle>Approval required</DialogTitle>
          <DialogDescription>
            This prompt is gated. Review and decide before the run continues. Esc
            and outside-clicks are intentionally disabled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[50vh] overflow-y-auto rounded-md border border-border bg-muted/20 p-3 text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Working dir
          </div>
          <div className="font-mono text-xs">{run.working_dir}</div>

          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Prompt
          </div>
          <div className="prose prose-sm prose-invert max-w-none">
            <Markdown>
              {(exec as { content?: string }).content ?? "(prompt content not loaded)"}
            </Markdown>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="destructive"
            disabled={actions.cancel.isPending}
            onClick={() => {
              if (window.confirm("Cancel the entire run?")) {
                actions.cancel.mutate();
              }
            }}
          >
            Cancel run
          </Button>
          <Button
            variant="outline"
            disabled={skip.isPending}
            onClick={() =>
              skip.mutate({
                promptId: exec.prompt_id,
                reason: "Rejected via approval modal",
              })
            }
          >
            Reject &amp; skip
          </Button>
          <Button
            disabled={approve.isPending}
            onClick={() =>
              approve.mutate({ promptId: exec.prompt_id, decision: "approve" })
            }
          >
            Approve &amp; continue
            <kbd className="ml-2 rounded bg-primary-foreground/10 px-1.5 py-0.5 text-[9px]">
              ⌘↵
            </kbd>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { GuardianDecisionRow } from "@/lib/guardian";
import { EyeIcon } from "lucide-react";
import { useState } from "react";

interface Props {
  decision: GuardianDecisionRow;
  runId: string;
}

const STRATEGY_LABELS: Record<GuardianDecisionRow["strategy"], string> = {
  rule: "Rule",
  default: "Default",
  llm: "LLM",
};

function formatTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function DecisionDetailDialog({ decision, runId }: Props) {
  const [open, setOpen] = useState(false);
  const [overrideText, setOverrideText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [overridden, setOverridden] = useState(decision.overriddenByHuman);
  const [savedResponse, setSavedResponse] = useState(decision.overrideResponse ?? "");

  async function handleOverride() {
    if (!overrideText.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/runs/${runId}/guardian/decisions/${decision.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrideResponse: overrideText.trim() }),
      });
      if (res.ok) {
        setSavedResponse(overrideText.trim());
        setOverridden(true);
        setOverrideText("");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="View decision details" />}
      >
        <EyeIcon />
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>Guardian Decision</DialogTitle>
          <DialogDescription>
            Full details for decision{" "}
            <span className="font-mono text-xs">{decision.id.slice(0, 8)}&hellip;</span>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="grid gap-4 pr-4">
            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StrategyBadge strategy={decision.strategy} />
              <span>{Math.round(decision.confidence * 100)}% confidence</span>
              {overridden && <Badge variant="outline">Human reviewed</Badge>}
              <span className="ml-auto font-mono">{formatTimestamp(decision.createdAt)}</span>
            </div>

            <DetailSection label="Question detected">
              {decision.questionDetected || <em className="text-muted-foreground">—</em>}
            </DetailSection>

            {decision.contextSnippet !== undefined && decision.contextSnippet !== "" && (
              <DetailSection label="Context snippet">
                <span className="font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {decision.contextSnippet}
                </span>
              </DetailSection>
            )}

            <DetailSection label="Decision">
              {decision.decision || <em className="text-muted-foreground">—</em>}
            </DetailSection>

            <DetailSection label="Reasoning">
              {decision.reasoning || <em className="text-muted-foreground">—</em>}
            </DetailSection>

            {savedResponse !== "" && (
              <DetailSection label="Human override response">{savedResponse}</DetailSection>
            )}

            {/* Override form */}
            <div className="grid gap-2 border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Override Guardian decision
              </p>
              <p className="text-xs text-muted-foreground">
                Submit your own answer to replace the Guardian&apos;s decision.
              </p>
              <div className="flex gap-2">
                <Input
                  value={overrideText}
                  onChange={(e) => setOverrideText(e.target.value)}
                  placeholder="Your decision…"
                  disabled={submitting}
                  className="flex-1 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleOverride();
                    }
                  }}
                />
                <Button
                  size="sm"
                  onClick={() => void handleOverride()}
                  disabled={submitting || !overrideText.trim()}
                >
                  {submitting ? "Saving…" : "Override"}
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

function DetailSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-sm leading-relaxed">{children}</p>
    </div>
  );
}

export function StrategyBadge({ strategy }: { strategy: GuardianDecisionRow["strategy"] }) {
  const variantMap: Record<GuardianDecisionRow["strategy"], "default" | "secondary" | "outline"> = {
    rule: "default",
    llm: "secondary",
    default: "outline",
  };

  return <Badge variant={variantMap[strategy]}>{STRATEGY_LABELS[strategy]}</Badge>;
}

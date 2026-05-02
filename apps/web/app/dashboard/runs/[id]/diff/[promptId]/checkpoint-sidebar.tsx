"use client";

import { CheckCircle2, Circle, XCircle } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface CheckpointEntry {
  promptExecutionId: string;
  promptId: string;
  sha: string;
  status: string;
  finishedAt: string | null;
}

interface CheckpointSidebarProps {
  runId: string;
  checkpoints: CheckpointEntry[];
  currentPromptId: string;
}

export function CheckpointSidebar({
  runId,
  checkpoints,
  currentPromptId,
}: CheckpointSidebarProps): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Puntos de control</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {checkpoints.map((cp) => {
          const isActive = cp.promptId === currentPromptId;
          const Icon =
            cp.status === "succeeded" ? CheckCircle2 : cp.status === "failed" ? XCircle : Circle;
          const iconClass =
            cp.status === "succeeded"
              ? "text-green-600"
              : cp.status === "failed"
                ? "text-red-600"
                : "text-muted-foreground";

          return (
            <Link
              key={cp.promptExecutionId}
              href={`/dashboard/runs/${runId}/diff/${cp.promptId}`}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                isActive ? "bg-primary/10 font-medium" : "hover:bg-muted"
              }`}
            >
              <Icon className={`w-4 h-4 ${iconClass}`} />
              <div className="flex-1 min-w-0">
                <div className="truncate">{cp.promptId}</div>
                <div className="text-xs text-muted-foreground font-mono">{cp.sha.slice(0, 8)}</div>
              </div>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}

"use client";

import { type LintIssue, type LintSeverity, lintPrompt } from "@/lib/plan-editor/prompt-linter";
import { cn } from "@/lib/utils";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
  WrenchIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

interface LintPanelProps {
  content: string;
  frontmatter: Record<string, unknown>;
  /** Called when the user applies a fix (so the parent can update content/fm) */
  onApplyFix?: (patch: { content?: string; frontmatter?: Record<string, unknown> }) => void;
}

function SeverityIcon({ severity }: { severity: LintSeverity }) {
  switch (severity) {
    case "error":
      return <AlertCircleIcon className="size-3.5 shrink-0 text-rose-500" />;
    case "warning":
      return <AlertTriangleIcon className="size-3.5 shrink-0 text-amber-500" />;
    case "info":
      return <InfoIcon className="size-3.5 shrink-0 text-sky-500" />;
  }
}

const SEVERITY_ORDER: Record<LintSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export function LintPanel({ content, frontmatter, onApplyFix }: LintPanelProps) {
  const [appliedFixes, setAppliedFixes] = useState<Set<string>>(new Set());

  const issues = useMemo(
    () =>
      lintPrompt(content, frontmatter).sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
      ),
    [content, frontmatter],
  );

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warning").length;

  function handleFix(issue: LintIssue) {
    if (!issue.fix) return;
    const patch = issue.fix();
    onApplyFix?.(patch);
    setAppliedFixes((prev) => new Set([...prev, issue.id]));
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3 flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Verificar
        </h3>
        {issues.length > 0 && (
          <div className="flex items-center gap-2">
            {errorCount > 0 && (
              <span className="text-xs text-rose-500 tabular-nums">
                {errorCount} error{errorCount !== 1 ? "es" : ""}
              </span>
            )}
            {warnCount > 0 && (
              <span className="text-xs text-amber-500 tabular-nums">
                {warnCount} advertencia{warnCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}
      </div>

      {/* No issues */}
      {issues.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-emerald-500 py-1">
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>No se encontraron problemas</span>
        </div>
      )}

      {/* Issue list */}
      {issues.length > 0 && (
        <div className="flex flex-col gap-2">
          {issues.map((issue) => {
            const fixed = appliedFixes.has(issue.id);
            return (
              <div
                key={issue.id}
                className={cn(
                  "flex items-start gap-2 text-xs rounded-md px-2 py-1.5",
                  issue.severity === "error" && "bg-rose-500/10",
                  issue.severity === "warning" && "bg-amber-500/10",
                  issue.severity === "info" && "bg-sky-500/10",
                  fixed && "opacity-50",
                )}
              >
                <SeverityIcon severity={issue.severity} />
                <span className="flex-1 leading-snug text-foreground/80">{issue.message}</span>
                {issue.fix && !fixed && onApplyFix && (
                  <button
                    type="button"
                    onClick={() => handleFix(issue)}
                    className="shrink-0 flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    title="Aplicar corrección"
                  >
                    <WrenchIcon className="size-3" />
                    Corregir
                  </button>
                )}
                {fixed && <CheckCircle2Icon className="size-3 shrink-0 text-emerald-500" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

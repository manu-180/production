import { DecisionDetailDialog, StrategyBadge } from "@/components/guardian/decision-detail-dialog";
import { GuardianMetricsWidget } from "@/components/guardian/guardian-metrics-widget";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EMPTY_METRICS,
  type GuardianDecisionRow,
  type GuardianMetrics,
  computeMetrics,
  mapDecisionRow,
} from "@/lib/guardian";
import { createServiceClient } from "@conductor/db";
import { ArrowLeftIcon, ShieldIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchDecisionsData(runId: string): Promise<{
  metrics: GuardianMetrics;
  decisions: GuardianDecisionRow[];
  runExists: boolean;
}> {
  const db = createServiceClient();

  // Verify run exists
  const { data: run } = await db.from("runs").select("id").eq("id", runId).single();
  if (run === null) {
    return { runExists: false, metrics: EMPTY_METRICS, decisions: [] };
  }

  // Get prompt execution IDs
  const { data: executions } = await db.from("prompt_executions").select("id").eq("run_id", runId);

  if (executions === null || executions.length === 0) {
    return { runExists: true, metrics: EMPTY_METRICS, decisions: [] };
  }

  const executionIds = executions.map((e) => e.id);

  // Fetch decisions
  const { data: rows } = await db
    .from("guardian_decisions")
    .select("*")
    .in("prompt_execution_id", executionIds)
    .order("created_at", { ascending: true });

  const decisions: GuardianDecisionRow[] = (rows ?? []).map((row) =>
    mapDecisionRow(row as Record<string, unknown>),
  );

  const metrics = computeMetrics(decisions);

  return { runExists: true, metrics, decisions };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function DecisionsSkeleton() {
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap gap-3">
        {(["a", "b", "c", "d"] as const).map((k) => (
          <Card key={k} size="sm" className="flex-1 min-w-[160px] animate-pulse">
            <CardContent className="h-16" />
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="h-48 animate-pulse" />
      </Card>
    </div>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

async function DecisionsContent({ runId }: { runId: string }) {
  const { runExists, metrics, decisions } = await fetchDecisionsData(runId);

  if (!runExists) {
    notFound();
  }

  return (
    <div className="grid gap-6">
      {/* Metrics row */}
      <GuardianMetricsWidget metrics={metrics} />

      {/* Decisions table */}
      {decisions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16">
            <ShieldIcon className="size-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No Guardian interventions for this run.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Question detected</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Reviewed</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {decisions.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {formatTime(d.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <span className="block truncate" title={d.questionDetected}>
                        {truncate(d.questionDetected, 80)}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <span className="block truncate" title={d.decision}>
                        {truncate(d.decision, 80)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StrategyBadge strategy={d.strategy} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {Math.round(d.confidence * 100)}%
                    </TableCell>
                    <TableCell>
                      {d.overriddenByHuman && (
                        <Badge variant="outline" className="text-xs">
                          Yes
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <DecisionDetailDialog decision={d} runId={runId} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function GuardianDecisionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: runId } = await params;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 w-full">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to run"
          render={<Link href={`/dashboard/runs/${runId}`} />}
        >
          <ArrowLeftIcon />
        </Button>
        <div className="flex items-center gap-2">
          <ShieldIcon className="size-5 text-muted-foreground" />
          <h1 className="font-heading text-lg font-semibold">Guardian Decisions</h1>
        </div>
        <span className="ml-auto font-mono text-xs text-muted-foreground">{runId}</span>
      </div>

      <Suspense fallback={<DecisionsSkeleton />}>
        <DecisionsContent runId={runId} />
      </Suspense>
    </div>
  );
}

import { createServiceClient } from "@conductor/db";
import { type NextRequest, NextResponse } from "next/server";

interface GuardianMetrics {
  totalInterventions: number;
  byStrategy: Record<"rule" | "default" | "llm", number>;
  averageConfidence: number;
  overrideRate: number;
}

const EMPTY_METRICS: GuardianMetrics = {
  totalInterventions: 0,
  byStrategy: { rule: 0, default: 0, llm: 0 },
  averageConfidence: 0,
  overrideRate: 0,
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: runId } = await params;
  const db = createServiceClient();

  // Verify the run exists
  const { data: run, error: runError } = await db
    .from("runs")
    .select("id")
    .eq("id", runId)
    .single();

  if (runError !== null || run === null) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Get all prompt execution IDs for this run
  const { data: executions, error: execError } = await db
    .from("prompt_executions")
    .select("id")
    .eq("run_id", runId);

  if (execError !== null || executions === null || executions.length === 0) {
    return NextResponse.json(EMPTY_METRICS);
  }

  const executionIds = executions.map((e) => e.id);

  // Get guardian decisions for those executions
  const { data: decisions, error: decisionsError } = await db
    .from("guardian_decisions")
    .select("strategy, confidence, reviewed_by_human")
    .in("prompt_execution_id", executionIds);

  if (decisionsError !== null || decisions === null || decisions.length === 0) {
    return NextResponse.json(EMPTY_METRICS);
  }

  const byStrategy: Record<"rule" | "default" | "llm", number> = {
    rule: 0,
    default: 0,
    llm: 0,
  };
  let confidenceSum = 0;
  let reviewedCount = 0;

  for (const row of decisions) {
    const strat = row.strategy;
    if (strat === "rule" || strat === "default" || strat === "llm") {
      byStrategy[strat] += 1;
    } else {
      byStrategy["default"] += 1;
    }

    const conf = row.confidence ?? 0;
    confidenceSum += conf;

    if (row.reviewed_by_human === true) reviewedCount += 1;
  }

  const metrics: GuardianMetrics = {
    totalInterventions: decisions.length,
    byStrategy,
    averageConfidence: confidenceSum / decisions.length,
    overrideRate: reviewedCount / decisions.length,
  };

  return NextResponse.json(metrics);
}

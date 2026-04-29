import { createServiceClient } from "@conductor/db";
import { type NextRequest, NextResponse } from "next/server";

export interface GuardianDecisionRow {
  id: string;
  promptExecutionId: string;
  questionDetected: string;
  contextSnippet?: string;
  decision: string;
  reasoning: string;
  confidence: number;
  strategy: "rule" | "default" | "llm";
  requiresHumanReview: boolean;
  overriddenByHuman: boolean;
  overrideResponse?: string;
  createdAt: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: runId } = await params;
  const db = createServiceClient();

  // Get all prompt execution IDs for this run
  const { data: executions, error: execError } = await db
    .from("prompt_executions")
    .select("id")
    .eq("run_id", runId);

  if (execError !== null || executions === null || executions.length === 0) {
    return NextResponse.json([] as GuardianDecisionRow[]);
  }

  const executionIds = executions.map((e) => e.id);

  // Get guardian decisions ordered oldest first
  const { data: decisions, error: decisionsError } = await db
    .from("guardian_decisions")
    .select("*")
    .in("prompt_execution_id", executionIds)
    .order("created_at", { ascending: true });

  if (decisionsError !== null || decisions === null) {
    return NextResponse.json([] as GuardianDecisionRow[]);
  }

  const rows: GuardianDecisionRow[] = decisions.map((row) => {
    const strat = row.strategy;
    const safeStrategy: "rule" | "default" | "llm" =
      strat === "rule" || strat === "default" || strat === "llm" ? strat : "default";

    const result: GuardianDecisionRow = {
      id: row.id,
      promptExecutionId: row.prompt_execution_id,
      questionDetected: row.question_detected ?? "",
      decision: row.decision ?? "",
      reasoning: row.reasoning ?? "",
      confidence: row.confidence ?? 0,
      strategy: safeStrategy,
      // DB uses reviewed_by_human; map to both fields for compatibility
      requiresHumanReview: false,
      overriddenByHuman: row.reviewed_by_human,
      createdAt: row.created_at,
    };

    if (row.context_snippet !== null && row.context_snippet !== undefined) {
      result.contextSnippet = row.context_snippet;
    }
    if (row.human_override !== null && row.human_override !== undefined) {
      result.overrideResponse = row.human_override;
    }

    return result;
  });

  return NextResponse.json(rows);
}

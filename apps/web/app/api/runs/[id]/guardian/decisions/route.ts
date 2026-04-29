import { type GuardianDecisionRow, mapDecisionRow } from "@/lib/guardian";
import { createServiceClient } from "@conductor/db";
import { type NextRequest, NextResponse } from "next/server";

export type { GuardianDecisionRow };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: runId } = await params;
  const db = createServiceClient();

  // Check run exists
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

  if (execError !== null) {
    return NextResponse.json({ error: execError.message }, { status: 500 });
  }

  if (executions === null || executions.length === 0) {
    return NextResponse.json([] as GuardianDecisionRow[]);
  }

  const executionIds = executions.map((e) => e.id);

  // Get guardian decisions ordered oldest first
  const { data: decisions, error: decisionsError } = await db
    .from("guardian_decisions")
    .select("*")
    .in("prompt_execution_id", executionIds)
    .order("created_at", { ascending: true });

  if (decisionsError !== null) {
    return NextResponse.json({ error: decisionsError.message }, { status: 500 });
  }

  const rows: GuardianDecisionRow[] = (decisions ?? []).map((row) =>
    mapDecisionRow(row as Record<string, unknown>),
  );

  return NextResponse.json(rows);
}

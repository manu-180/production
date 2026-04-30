import { GitManager } from "@conductor/core";
import { createServiceClient } from "@conductor/db";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const BodySchema = z.object({
  promptId: z.string().min(1),
  sha: z.string().min(7), // git short SHAs are min 7 chars; full are 40
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: runId } = await params;

  // Parse body
  let body: z.infer<typeof BodySchema>;
  try {
    const json = await req.json();
    body = BodySchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  const db = createServiceClient();

  // Verify run exists, get working_dir
  const { data: run, error: runErr } = await db
    .from("runs")
    .select("id, status, working_dir")
    .eq("id", runId)
    .single();

  if (runErr !== null || run === null) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Verify the target sha belongs to a prompt_execution in this run
  const { data: execution, error: execErr } = await db
    .from("prompt_executions")
    .select("id, prompt_id, checkpoint_sha")
    .eq("run_id", runId)
    .eq("prompt_id", body.promptId)
    .eq("checkpoint_sha", body.sha)
    .single();

  if (execErr !== null || execution === null) {
    return NextResponse.json({ error: "Checkpoint not found for this run" }, { status: 404 });
  }

  // Run git revert
  const gitManager = new GitManager(run.working_dir, run.working_dir);

  let revertSha: string;
  try {
    // First check it's a repo
    const isRepo = await gitManager.isRepo();
    if (!isRepo) {
      return NextResponse.json(
        { error: "Working directory is not a git repository" },
        { status: 500 },
      );
    }
    revertSha = await gitManager.revert(body.sha);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Conflict markers in the message → 409 Conflict
    const isConflict = /conflict|CONFLICT/.test(message);
    return NextResponse.json(
      {
        error: isConflict
          ? "Revert produced conflicts; resolve manually"
          : `Rollback failed: ${message}`,
      },
      { status: isConflict ? 409 : 500 },
    );
  }

  return NextResponse.json({
    success: true,
    revertSha,
    message: `Reverted ${body.sha.slice(0, 8)} as new commit ${revertSha.slice(0, 8)}`,
  });
}

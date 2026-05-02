import { DiffExtractor, type FileDiff, GitManager } from "@conductor/core";
import { createServiceClient } from "@conductor/db";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckpointSidebar } from "./checkpoint-sidebar";
import { DiffViewer } from "./diff-viewer";
import { RollbackButton } from "./rollback-button";

interface PageProps {
  params: Promise<{ id: string; promptId: string }>;
}

interface CheckpointEntry {
  promptExecutionId: string;
  promptId: string;
  sha: string;
  status: string;
  finishedAt: string | null;
}

interface DiffPageData {
  runStatus: string;
  workingDir: string;
  targetSha: string;
  fromSha: string;
  diff: string;
  parsed: FileDiff[];
  checkpoints: CheckpointEntry[];
  currentExecutionId: string;
}

async function loadDiffData(runId: string, promptId: string): Promise<DiffPageData | null> {
  const db = createServiceClient();

  const { data: run } = await db
    .from("runs")
    .select("id, status, working_dir, checkpoint_branch")
    .eq("id", runId)
    .single();

  if (run === null) return null;

  // Get all prompt_executions for this run, ordered by created_at, that have checkpoint_sha
  const { data: executions } = await db
    .from("prompt_executions")
    .select("id, prompt_id, status, checkpoint_sha, finished_at, created_at")
    .eq("run_id", runId)
    .not("checkpoint_sha", "is", null)
    .order("created_at", { ascending: true });

  if (executions === null || executions.length === 0) return null;

  // Find the target execution
  const targetIdx = executions.findIndex((e) => e.prompt_id === promptId);
  if (targetIdx === -1) return null;

  const target = executions[targetIdx];
  if (target === undefined || target.checkpoint_sha === null) return null;

  // fromSha is the previous checkpoint sha, or `<sha>^` if first prompt.
  const previous = targetIdx > 0 ? executions[targetIdx - 1] : null;
  const fromSha = previous?.checkpoint_sha ?? `${target.checkpoint_sha}^`;

  // Use GitManager + DiffExtractor to compute the diff
  const gitManager = new GitManager(run.working_dir, run.working_dir);
  const diffExtractor = new DiffExtractor(gitManager);

  let diff = "";
  let parsed: FileDiff[] = [];
  try {
    diff = await diffExtractor.getFullDiff(fromSha, target.checkpoint_sha);
    parsed = diffExtractor.parseUnifiedDiff(diff);
  } catch (err) {
    console.error("[diff page] Failed to compute diff:", err);
    // Continue with empty diff — the page will show an error state
  }

  return {
    runStatus: run.status,
    workingDir: run.working_dir,
    targetSha: target.checkpoint_sha,
    fromSha,
    diff,
    parsed,
    checkpoints: executions
      .filter((e) => e.checkpoint_sha !== null)
      .map((e) => ({
        promptExecutionId: e.id,
        promptId: e.prompt_id,
        sha: e.checkpoint_sha as string,
        status: e.status,
        finishedAt: e.finished_at,
      })),
    currentExecutionId: target.id,
  };
}

export default async function DiffPage({ params }: PageProps): Promise<React.ReactElement> {
  const { id: runId, promptId } = await params;
  const data = await loadDiffData(runId, promptId);

  if (data === null) notFound();

  return (
    <div className="grid grid-cols-[280px_1fr] gap-6 p-6">
      <CheckpointSidebar runId={runId} checkpoints={data.checkpoints} currentPromptId={promptId} />

      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Diferencias del prompt: {promptId}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {data.fromSha.slice(0, 8)} → {data.targetSha.slice(0, 8)}
              </p>
            </div>
            <RollbackButton runId={runId} promptId={promptId} sha={data.targetSha} />
          </CardHeader>
          <CardContent>
            {data.parsed.length === 0 ? (
              <p className="text-muted-foreground">Sin cambios en este punto de control.</p>
            ) : (
              <p className="text-sm">{data.parsed.length} archivo(s) modificado(s)</p>
            )}
          </CardContent>
        </Card>

        {data.parsed.map((file, idx) => (
          <DiffViewer key={`${file.path}-${idx}`} file={file} />
        ))}
      </div>
    </div>
  );
}

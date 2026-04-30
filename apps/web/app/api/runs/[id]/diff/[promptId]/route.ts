import { defineRoute, respond, respondError } from "@/lib/api";
import { assertRunOwned } from "@/lib/api/run-utils";
import { GitManager } from "@conductor/core";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
  promptId: string;
}

/**
 * GET /api/runs/:id/diff/:promptId — unified git diff produced by a prompt.
 *
 * Builds the diff between the prompt's `checkpoint_sha` and its parent (the
 * preceding execution's checkpoint, falling back to `HEAD~1` for the first
 * prompt of the plan). Uses the run's `working_dir` as the git repo, so this
 * is only useful while the working tree still contains the relevant commits.
 *
 * Returns:
 *   { fromSha, toSha, diff, stats: { filesChanged, additions, deletions } }
 */
export const GET = defineRoute<undefined, undefined, Params>(
  {},
  async ({ user, traceId, params }) => {
    const owned = await assertRunOwned(user.db, params.id, user.userId);
    if (owned === null) {
      return respondError("not_found", "Run not found", { traceId });
    }

    const { data: target } = await user.db
      .from("prompt_executions")
      .select("id, prompt_id, checkpoint_sha")
      .eq("run_id", owned.id)
      .eq("prompt_id", params.promptId)
      .maybeSingle();

    if (target === null) {
      return respondError("not_found", "Prompt execution not found for this run", { traceId });
    }
    if (target.checkpoint_sha === null) {
      return respondError("not_found", "Prompt has no checkpoint yet", { traceId });
    }

    const parentSha = await resolveParentSha(user.db, owned.id, target.prompt_id);

    const git = new GitManager(owned.working_dir, owned.working_dir);
    try {
      if (!(await git.isRepo())) {
        return respondError("internal", "Working directory is not a git repository", {
          traceId,
          details: { workingDir: owned.working_dir },
        });
      }

      const fromSha = parentSha ?? `${target.checkpoint_sha}~1`;
      const toSha = target.checkpoint_sha;

      const [diff, numstat] = await Promise.all([
        git.getDiff(fromSha, toSha),
        git.getNumstat(fromSha, toSha),
      ]);

      const stats = numstat.reduce(
        (acc, row) => ({
          filesChanged: acc.filesChanged + 1,
          additions: acc.additions + row.added,
          deletions: acc.deletions + row.removed,
        }),
        { filesChanged: 0, additions: 0, deletions: 0 },
      );

      return respond({ fromSha, toSha, diff, stats }, { traceId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/unknown revision|bad revision|fatal: ambiguous/i.test(message)) {
        return respondError("not_found", "Checkpoint commit no longer exists in working tree", {
          traceId,
          details: { message },
        });
      }
      return respondError("internal", `git diff failed: ${message}`, { traceId });
    }
  },
);

/**
 * Find the SHA of the prompt that ran immediately before this one in the run.
 * Returns `null` when this is the first prompt — caller falls back to `HEAD~1`.
 */
async function resolveParentSha(
  db: import("@conductor/db").ServiceClient,
  runId: string,
  promptId: string,
): Promise<string | null> {
  // The prompt's order_index defines linear order within a plan; we need the
  // execution of the prompt with the largest order_index that is strictly
  // smaller than the target's. We do this in two steps because PostgREST
  // can't express "join + order by joined column + limit 1" cleanly.
  const { data: targetPrompt } = await db
    .from("prompts")
    .select("order_index, plan_id")
    .eq("id", promptId)
    .maybeSingle();

  if (targetPrompt === null || targetPrompt.order_index === 0) return null;

  const { data: prevPrompts } = await db
    .from("prompts")
    .select("id")
    .eq("plan_id", targetPrompt.plan_id)
    .lt("order_index", targetPrompt.order_index)
    .order("order_index", { ascending: false })
    .limit(1);

  const prev = (prevPrompts ?? [])[0];
  if (prev === undefined) return null;

  const { data: prevExec } = await db
    .from("prompt_executions")
    .select("checkpoint_sha")
    .eq("run_id", runId)
    .eq("prompt_id", prev.id)
    .maybeSingle();

  return prevExec?.checkpoint_sha ?? null;
}

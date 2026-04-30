import { defineRoute, respond, respondError } from "@/lib/api";
import { assertRunOwned } from "@/lib/api/run-utils";
import { GitManager } from "@conductor/core";
import { z } from "zod";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

/**
 * POST /api/runs/:id/rollback — revert a checkpoint as a new commit.
 *
 * Loose schema vs the strict `rollbackSchema` in `lib/validators/runs.ts` —
 * this legacy path expects `{ promptId, sha }` (both required) so the worker
 * can locate the matching prompt_execution. The strict schema there is a
 * superset for future tooling that may pass only one of the two; we keep
 * the loose form here for backwards compatibility.
 */
const legacyRollbackSchema = z.object({
  promptId: z.string().min(1),
  sha: z.string().min(7),
});
type LegacyRollback = z.infer<typeof legacyRollbackSchema>;

export const POST = defineRoute<LegacyRollback, undefined, Params>(
  { rateLimit: "mutation", bodySchema: legacyRollbackSchema },
  async ({ user, traceId, body, params }) => {
    const owned = await assertRunOwned(user.db, params.id, user.userId);
    if (owned === null) {
      return respondError("not_found", "Run not found", { traceId });
    }

    const { data: execution } = await user.db
      .from("prompt_executions")
      .select("id, prompt_id, checkpoint_sha")
      .eq("run_id", owned.id)
      .eq("prompt_id", body.promptId)
      .eq("checkpoint_sha", body.sha)
      .maybeSingle();

    if (execution === null) {
      return respondError("not_found", "Checkpoint not found for this run", { traceId });
    }

    const git = new GitManager(owned.working_dir, owned.working_dir);
    let revertSha: string;
    try {
      if (!(await git.isRepo())) {
        return respondError("internal", "Working directory is not a git repository", {
          traceId,
          details: { workingDir: owned.working_dir },
        });
      }
      revertSha = await git.revert(body.sha);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isConflict = /conflict/i.test(message);
      if (isConflict) {
        return respondError("conflict", "Revert produced conflicts; resolve manually", {
          traceId,
          details: { message },
        });
      }
      return respondError("internal", `Rollback failed: ${message}`, {
        traceId,
        details: { message },
      });
    }

    return respond(
      {
        success: true,
        revertSha,
        message: `Reverted ${body.sha.slice(0, 8)} as new commit ${revertSha.slice(0, 8)}`,
      },
      { traceId },
    );
  },
);

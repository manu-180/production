/**
 * Conductor — CheckpointManager
 *
 * Orchestrates git operations during a Conductor run:
 * - Creates a run-scoped branch before execution starts.
 * - Commits a git checkpoint after each successful prompt.
 * - Rolls back to a known-good SHA on failure.
 * - Merges the run branch back into the original branch on success.
 */

import {
  type PromptCheckpointInfo,
  formatCheckpointMessage,
  formatNoChangesMessage,
} from "./commit-message-formatter.js";
import type { GitManager } from "./git-manager.js";
import { SafetyGuards } from "./safety-guards.js";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class CheckpointManagerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CheckpointManagerError";
  }
}

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface PromptMetadata {
  title: string;
  filename: string;
  order: number;
  total: number;
}

export interface CheckpointEntry {
  promptId: string;
  executionId: string;
  sha: string;
  message: string;
  createdAt: Date;
}

export interface RunInitResult {
  runBranch: string;
  baseSha: string;
}

// ---------------------------------------------------------------------------
// Execution metadata shape
// ---------------------------------------------------------------------------

interface ExecutionMeta {
  tokensIn: number;
  tokensOut: number;
  tokensCache: number;
  costUsd: number;
  durationMs: number;
  toolsUsed: string[];
  guardianDecisions: number;
}

// ---------------------------------------------------------------------------
// CheckpointManager
// ---------------------------------------------------------------------------

export class CheckpointManager {
  /** Stores metadata set by setPromptMeta() */
  private readonly promptMetaMap = new Map<string, PromptMetadata>();
  /** Stores execution metadata at commit time (for commit messages) */
  private readonly executionMetaMap = new Map<string, ExecutionMeta>();
  /** Ordered list of checkpoints made during this run */
  private checkpoints: CheckpointEntry[] = [];
  /** SHA before any run changes (for rollback baseline) */
  private baseSha: string | null = null;
  /** Branch created for this run (null when noBranch mode is active) */
  private runBranch: string | null = null;
  /**
   * True after a successful initRun — used to gate commit()/rollback() in
   * branchless mode where runBranch stays null even after init.
   */
  private initialized = false;
  /** True when initRun was called with noBranch:true — skip merge/delete in finishRun. */
  private noBranchMode = false;
  /** Set to true after finishRun succeeds — blocks further git operations */
  private finished = false;

  constructor(
    private readonly gitManager: GitManager,
    private readonly runId: string,
    private readonly workingDir: string,
  ) {}

  // -------------------------------------------------------------------------
  // Run lifecycle
  // -------------------------------------------------------------------------

  /**
   * Called before run starts — records the base SHA for later rollback and
   * (optionally) creates a run-scoped branch.
   *
   * @param originalBranch - The branch the user is currently on. In noBranch
   *   mode this becomes the branch we commit on directly (no isolation).
   * @param opts.noBranch - When true, skip branch creation entirely and let
   *   the orchestrator commit directly on the current HEAD (typically `main`).
   *   `finishRun` then becomes a no-op for git. Used in single-developer
   *   workflows where the user explicitly wants every change on `main`.
   *
   * Returns the branch name (the current branch when noBranch:true, the new
   * run branch otherwise) and the base SHA.
   */
  async initRun(originalBranch: string, opts?: { noBranch?: boolean }): Promise<RunInitResult> {
    if (this.initialized) {
      throw new CheckpointManagerError(
        "ALREADY_INITIALIZED",
        this.runBranch !== null
          ? `Run already initialized on branch ${this.runBranch}`
          : "Run already initialized (noBranch mode)",
      );
    }

    const noBranch = opts?.noBranch === true;

    if (noBranch) {
      // Direct-to-HEAD mode: no isolation, commits land on the current branch
      // (typically `main`). Rollback still works because we record baseSha.
      const baseSha = await this.gitManager.getHeadSha();
      this.baseSha = baseSha;
      this.runBranch = null;
      this.noBranchMode = true;
      this.initialized = true;
      return { runBranch: originalBranch, baseSha };
    }

    const branchName = `conductor/run-${this.runId.slice(0, 8)}`;

    // createBranch internally calls checkoutLocalBranch, so HEAD moves to the new branch.
    await this.gitManager.createBranch(branchName);

    const baseSha = await this.gitManager.getHeadSha();

    this.baseSha = baseSha;
    this.runBranch = branchName;
    this.initialized = true;

    return { runBranch: branchName, baseSha };
  }

  /**
   * Called by the orchestrator after each prompt's metadata is known (before
   * commit). Decouples the orchestrator from commit message formatting details.
   */
  setPromptMeta(promptId: string, meta: PromptMetadata): void {
    this.promptMetaMap.set(promptId, meta);
  }

  /**
   * Called by the orchestrator after each prompt's execution stats are known.
   */
  setExecutionMeta(promptId: string, meta: ExecutionMeta): void {
    this.executionMetaMap.set(promptId, meta);
  }

  // -------------------------------------------------------------------------
  // CheckpointManager interface (used by orchestrator)
  // -------------------------------------------------------------------------

  /**
   * Stages all changes, commits them (with allowEmpty so prompts that change
   * nothing still get a checkpoint), and records the resulting SHA.
   *
   * Returns the new HEAD SHA.
   */
  async commit(promptId: string, executionId: string): Promise<string> {
    if (this.finished) {
      throw new CheckpointManagerError(
        "RUN_FINISHED",
        "Cannot perform git operations after run has finished.",
      );
    }
    if (!this.initialized) {
      throw new CheckpointManagerError(
        "RUN_NOT_INITIALIZED",
        "initRun() must be called before commit().",
      );
    }

    await this.gitManager.add(".");

    const message = this.buildCommitMessage(promptId, executionId);

    // gitManager.commit already returns the new HEAD SHA — use it directly.
    // This avoids a second git call (getHeadSha) that could fail and leave
    // the in-memory checkpoints array out of sync with git history.
    const sha = await this.gitManager.commit(message, { allowEmpty: true });

    // Constructing and pushing the entry only after the commit call succeeded
    // means: if the git op throws, the array stays consistent (no entry leaks).
    // Array.push on a normal array cannot fail synchronously.
    this.checkpoints.push({
      promptId,
      executionId,
      sha,
      message,
      createdAt: new Date(),
    });

    return sha;
  }

  /**
   * Discards any uncommitted changes the working tree currently holds. Used
   * by the orchestrator after a wave that failed entirely, so the next
   * prompt starts from a clean tree (matching the last successful commit)
   * rather than inheriting partial edits from the failed attempt.
   *
   * Implementation: `git checkout -- .` — restores tracked files only.
   * Untracked files are intentionally preserved so a user's in-progress
   * scratch work isn't deleted.
   */
  async discardDirty(): Promise<void> {
    if (this.finished) return;
    if (!this.initialized) return;
    try {
      await this.gitManager.restoreWorkingTree();
    } catch (err) {
      throw new CheckpointManagerError(
        "DISCARD_DIRTY_FAILED",
        `git checkout -- . failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Rolls back the working tree to a given SHA that must be in the known
   * checkpoint history of this run. Removes stale checkpoint entries that
   * come after the target SHA.
   */
  async rollback(sha: string): Promise<void> {
    if (this.finished) {
      throw new CheckpointManagerError(
        "RUN_FINISHED",
        "Cannot perform git operations after run has finished.",
      );
    }
    if (!this.initialized) {
      throw new CheckpointManagerError(
        "RUN_NOT_INITIALIZED",
        "initRun() must be called before rollback().",
      );
    }

    // Validate the sha is in our own checkpoint list first (fast path, no git
    // call needed) — also covers the baseSha so callers can roll back to start.
    const knownShas = new Set(this.checkpoints.map((e) => e.sha));
    if (this.baseSha !== null) knownShas.add(this.baseSha);

    if (!knownShas.has(sha)) {
      throw new CheckpointManagerError(
        "UNKNOWN_ROLLBACK_TARGET",
        `Cannot roll back to "${sha}": SHA is not in the recorded checkpoint history for this run.`,
      );
    }

    // Compute which entries survive the rollback — purely in-memory, no git yet.
    const rollbackIdx = this.checkpoints.findIndex((e) => e.sha === sha);
    // If sha is baseSha, rollbackIdx === -1 → keep nothing; otherwise keep up to and including target.
    const entriesToKeep = rollbackIdx === -1 ? [] : this.checkpoints.slice(0, rollbackIdx + 1);
    const removed = this.checkpoints.slice(entriesToKeep.length);

    // Prune in memory BEFORE the destructive git operation.
    this.checkpoints = entriesToKeep;

    try {
      // gitManager.resetHard internally validates that sha is reachable from the
      // current branch via SafetyGuards.validateResetTarget — double safety.
      await this.gitManager.resetHard(sha);
    } catch (err) {
      // Restore state so in-memory and git remain consistent.
      this.checkpoints = [...entriesToKeep, ...removed];
      throw new CheckpointManagerError(
        "ROLLBACK_FAILED",
        `git reset --hard failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Called at the end of a run to either merge the run branch into the
   * original branch (on success) or abandon it for inspection (on failure).
   */
  async finishRun(
    success: boolean,
    originalBranch: string,
    opts?: { mergeToOriginal?: boolean; deleteRunBranch?: boolean },
  ): Promise<void> {
    if (this.finished) {
      throw new CheckpointManagerError(
        "RUN_FINISHED",
        "finishRun() has already been called for this run.",
      );
    }

    const mergeToOriginal = opts?.mergeToOriginal ?? true;
    const deleteRunBranch = opts?.deleteRunBranch ?? true;

    try {
      // noBranch mode: nothing to merge or delete — commits already landed on
      // the original branch directly. Just mark finished and exit.
      if (this.noBranchMode) {
        return;
      }

      if (success && this.runBranch !== null) {
        const runBranch = this.runBranch;

        if (mergeToOriginal) {
          // Capture the run branch tip SHA before the merge so we can validate.
          const runTipSha = await this.gitManager.getHeadSha();

          await this.gitManager.mergeFastForward(runBranch, originalBranch);

          // Validate the merge completed correctly. If this throws, the
          // run branch is left intact for inspection (deleteBranch is skipped
          // because we never reach it).
          const postMergeHeadSha = await this.gitManager.getHeadSha();
          SafetyGuards.validateMergeComplete(runTipSha, postMergeHeadSha);
        }

        // Only attempt branch deletion after merge has been validated (or
        // explicitly skipped). If deletion fails, surface a distinct error
        // code so the caller can react — the merge itself succeeded.
        if (deleteRunBranch) {
          try {
            await this.gitManager.deleteBranch(runBranch);
          } catch (err) {
            throw new CheckpointManagerError(
              "BRANCH_DELETE_FAILED",
              `Run completed and merged successfully, but failed to delete branch ${runBranch}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }

        // Clear the runBranch reference now that cleanup has succeeded.
        this.runBranch = null;
      } else if (!success) {
        // On failure: return to the original branch and leave the run branch
        // intact so the developer can inspect what happened.
        await this.gitManager.checkout(originalBranch);
      }
    } finally {
      // Always mark the run as finished — even if merge validation, branch
      // deletion, or checkout threw — so subsequent commit/rollback calls
      // are blocked. The run is over either way.
      this.finished = true;
    }
  }

  // -------------------------------------------------------------------------
  // Inspection helpers
  // -------------------------------------------------------------------------

  /** Returns all checkpoints in creation order. */
  async getCheckpoints(): Promise<CheckpointEntry[]> {
    return [...this.checkpoints];
  }

  /**
   * Returns the unified diff for a specific prompt's changes.
   * The first checkpoint diffs against baseSha; subsequent ones diff against
   * the previous checkpoint's SHA.
   */
  async getDiffForPrompt(promptId: string): Promise<string> {
    if (this.finished) {
      throw new CheckpointManagerError(
        "RUN_FINISHED",
        "Cannot perform git operations after run has finished.",
      );
    }
    if (!this.initialized) {
      throw new CheckpointManagerError(
        "RUN_NOT_INITIALIZED",
        "initRun() must be called before getDiffForPrompt().",
      );
    }

    const idx = this.checkpoints.findIndex((e) => e.promptId === promptId);
    if (idx === -1)
      throw new CheckpointManagerError(
        "NOT_FOUND",
        `No checkpoint found for promptId: ${promptId}`,
      );

    const entry = this.checkpoints[idx];
    if (entry === undefined) {
      throw new CheckpointManagerError(
        "NOT_FOUND",
        `No checkpoint found for promptId: ${promptId}`,
      );
    }
    const toSha = entry.sha;

    const fromEntry = idx > 0 ? this.checkpoints[idx - 1] : undefined;
    const fromSha = fromEntry !== undefined ? fromEntry.sha : this.baseSha;

    if (fromSha === null) {
      throw new CheckpointManagerError(
        "NO_BASE_SHA",
        "No base SHA recorded. initRun() must be called before getDiffForPrompt().",
      );
    }

    return this.gitManager.getDiff(fromSha, toSha);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildCommitMessage(promptId: string, executionId: string): string {
    const promptMeta = this.promptMetaMap.get(promptId);
    const execMeta = this.executionMetaMap.get(promptId);

    if (promptMeta === undefined || execMeta === undefined) {
      // Fallback: produce a minimal message so the commit still has context.
      return formatNoChangesMessage(this.runId.slice(0, 8), 0, `prompt-${promptId}`);
    }

    const info: PromptCheckpointInfo = {
      runId: this.runId.slice(0, 8),
      promptOrder: promptMeta.order,
      totalPrompts: promptMeta.total,
      promptTitle: promptMeta.title,
      promptFilename: promptMeta.filename,
      executionId,
      toolsUsed: execMeta.toolsUsed,
      durationMs: execMeta.durationMs,
      tokensIn: execMeta.tokensIn,
      tokensOut: execMeta.tokensOut,
      tokensCache: execMeta.tokensCache,
      costUsd: execMeta.costUsd,
      guardianDecisions: execMeta.guardianDecisions,
    };

    return formatCheckpointMessage(info);
  }
}

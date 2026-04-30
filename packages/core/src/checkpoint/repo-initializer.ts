/**
 * Conductor — RepoInitializer
 *
 * Validates and initializes a git repository before a Conductor run starts.
 * Handles auto-init of new repos, stashing dirty working trees, and restoring
 * state after the run completes.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GitManager } from "./git-manager.js";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class RepoInitializerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RepoInitializerError";
  }
}

// ---------------------------------------------------------------------------
// Result & options interfaces
// ---------------------------------------------------------------------------

export interface RepoInitResult {
  /** true if we had to init a new repo */
  wasInitialized: boolean;
  /** true if we stashed dirty changes */
  wasStashed: boolean;
  /** e.g. "stash@{0}" — null if nothing stashed */
  stashRef: string | null;
  /** branch that was active when run started */
  originalBranch: string;
  /** HEAD SHA when run started (after stash if any) */
  baseSha: string;
}

export interface RepoInitOptions {
  /** default true: init repo if not one */
  autoInitGit?: boolean;
  /** default true: stash dirty working tree */
  autoStash?: boolean;
}

// ---------------------------------------------------------------------------
// Default .gitignore content
// ---------------------------------------------------------------------------

const DEFAULT_GITIGNORE = ["node_modules/", ".env", "*.log", "dist/", ".next/", "build/"].join(
  "\n",
);

// ---------------------------------------------------------------------------
// RepoInitializer
// ---------------------------------------------------------------------------

export class RepoInitializer {
  constructor(private readonly gitManager: GitManager) {}

  /**
   * Prepares the working directory for a Conductor run:
   * 1. Ensures it is a git repo (initializing one if allowed).
   * 2. Stashes any dirty changes (if allowed).
   * 3. Records the current branch and HEAD SHA for later restoration.
   */
  async initForRun(
    workingDir: string,
    runId: string,
    opts?: RepoInitOptions,
  ): Promise<RepoInitResult> {
    const autoInitGit = opts?.autoInitGit !== false;
    const autoStash = opts?.autoStash !== false;

    // Step 1 — Ensure this is a git repo
    let wasInitialized = false;
    const isRepo = await this.gitManager.isRepo();

    if (!isRepo) {
      if (!autoInitGit) {
        throw new RepoInitializerError(
          "WORKING_DIR_NOT_GIT_REPO",
          `Working directory "${workingDir}" is not a git repository and autoInitGit is disabled.`,
        );
      }

      await this.gitManager.init();

      // Write a .gitignore before the initial commit
      await writeFile(join(workingDir, ".gitignore"), DEFAULT_GITIGNORE, "utf8");

      await this.gitManager.add(".");
      await this.gitManager.commit("chore: initial commit by Conductor", { allowEmpty: true });

      wasInitialized = true;
    }

    // Step 2 — Handle dirty working tree
    let wasStashed = false;
    let stashRef: string | null = null;

    const status = await this.gitManager.getStatus();
    const isDirty =
      status.modified.length > 0 ||
      status.not_added.length > 0 ||
      status.created.length > 0 ||
      status.deleted.length > 0 ||
      status.renamed.length > 0 ||
      status.staged.length > 0 ||
      status.conflicted.length > 0;

    if (isDirty) {
      if (!autoStash) {
        throw new RepoInitializerError(
          "DIRTY_WORKING_TREE",
          "Working tree has uncommitted changes. Commit or stash them before running Conductor, or set autoStash to true.",
        );
      }

      await this.gitManager.stash(`conductor-pre-run-${runId}`, true);
      wasStashed = true;
      stashRef = "stash@{0}";
    }

    // Step 3 — Record current state
    const originalBranch = await this.gitManager.getCurrentBranch();
    const baseSha = await this.gitManager.getHeadSha();

    return {
      wasInitialized,
      wasStashed,
      stashRef,
      originalBranch,
      baseSha,
    };
  }

  /**
   * Restores the repository to its pre-run state:
   * - Verifies the expected stash is still at stash@{0} before popping.
   * - Pops the stash if one was created.
   * - Checks out the original branch (in case the run left us on a run branch).
   *
   * Throws RepoInitializerError with specific codes on failure so callers can
   * surface actionable messages to the user.
   */
  async restoreAfterRun(result: RepoInitResult): Promise<void> {
    if (result.wasStashed && result.stashRef !== null) {
      // Guard against the stash@{0} race condition: verify that the stash
      // entry at stashRef still carries a Conductor label before popping it.
      // This catches the case where a user or external process pushed a new
      // stash between our `stash` and this `restoreAfterRun` call.
      const msg = await this.gitManager.getStashMessage(result.stashRef);
      if (!msg?.includes("conductor-pre-run-")) {
        throw new RepoInitializerError(
          "STASH_MISMATCH",
          `Stash at ${result.stashRef} doesn't match the expected Conductor stash. Manual intervention required. Expected a message containing "conductor-pre-run-", but found: ${msg ?? "(no stash at this ref)"}`,
        );
      }

      try {
        await this.gitManager.stashPop(result.stashRef);
      } catch (err) {
        throw new RepoInitializerError(
          "STASH_POP_FAILED",
          `Failed to restore stashed changes. Manual 'git stash pop' may be needed.\n${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    try {
      await this.gitManager.checkout(result.originalBranch);
    } catch (err) {
      throw new RepoInitializerError(
        "CHECKOUT_FAILED",
        `Failed to return to original branch '${result.originalBranch}'.\n${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

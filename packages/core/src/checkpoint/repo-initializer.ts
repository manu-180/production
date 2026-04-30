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
   * - Pops the stash if one was created.
   * - Checks out the original branch (in case the run left us on a run branch).
   */
  async restoreAfterRun(result: RepoInitResult): Promise<void> {
    if (result.wasStashed && result.stashRef !== null) {
      await this.gitManager.stashPop(result.stashRef);
    }

    await this.gitManager.checkout(result.originalBranch);
  }
}

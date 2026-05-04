/**
 * Conductor — RepoInitializer
 *
 * Validates and initializes a git repository before a Conductor run starts.
 * Handles auto-init of new repos, stashing dirty working trees, and restoring
 * state after the run completes.
 *
 * Untracked-file safety: before stashing with `--include-untracked`, every
 * untracked path is also copied to `~/.conductor/untracked-backups/<runId>/`.
 * If `git stash pop` later fails (typically because the run produced files at
 * the same paths), the stash is kept intact AND any missing files are
 * restored from the on-disk backup. This means a run can never "delete"
 * the user's untracked work — even on worker crash, the backup remains on
 * disk for manual recovery.
 */

import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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

export interface UntrackedBackup {
  /** Absolute backup directory under ~/.conductor/untracked-backups/<runId>/ */
  backupDir: string;
  /** Relative paths (from workingDir) that were copied into backupDir. */
  backedUpPaths: string[];
}

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
  /**
   * Disk backup of the user's pre-run untracked files. null when nothing was
   * untracked. Always populated when stashing untracked, so restoreAfterRun
   * has a fallback if `git stash pop` conflicts with run output.
   */
  untrackedBackup: UntrackedBackup | null;
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
// Backup root resolution
// ---------------------------------------------------------------------------

/**
 * Returns the absolute backup directory for a given run.
 * Backups live OUTSIDE the working tree so they're never picked up by git
 * stash, .gitignore, or branch checkouts.
 */
export function getUntrackedBackupDir(runId: string): string {
  return join(homedir(), ".conductor", "untracked-backups", runId);
}

// ---------------------------------------------------------------------------
// RepoInitializer
// ---------------------------------------------------------------------------

export class RepoInitializer {
  constructor(private readonly gitManager: GitManager) {}

  /**
   * Prepares the working directory for a Conductor run:
   * 1. Ensures it is a git repo (initializing one if allowed).
   * 2. Backs up untracked files to disk (outside the working tree).
   * 3. Stashes any dirty changes (if allowed).
   * 4. Records the current branch and HEAD SHA for later restoration.
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
    let untrackedBackup: UntrackedBackup | null = null;

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

      // Step 2a — Backup untracked files BEFORE stashing. If this fails we
      // refuse to stash: untracked files would otherwise become unrecoverable
      // if `git stash pop` later conflicts with run output.
      if (status.not_added.length > 0) {
        try {
          untrackedBackup = await this.backupUntrackedFiles(workingDir, runId, status.not_added);
        } catch (err) {
          throw new RepoInitializerError(
            "UNTRACKED_BACKUP_FAILED",
            `Failed to back up untracked files before stash. Aborting to avoid data loss.\n${err instanceof Error ? err.message : String(err)}`,
          );
        }
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
      untrackedBackup,
    };
  }

  /**
   * Restores the repository to its pre-run state:
   * - Verifies the expected stash is still at stash@{0} before popping.
   * - Pops the stash if one was created.
   * - On pop conflict (run output collides with stashed untracked), restores
   *   missing files from the disk backup. The stash is KEPT intact for manual
   *   inspection — never auto-dropped (that path destroyed user data before).
   * - Checks out the original branch.
   */
  async restoreAfterRun(result: RepoInitResult, workingDir?: string): Promise<void> {
    if (result.wasStashed && result.stashRef !== null) {
      // Guard against the stash@{0} race condition: verify that the stash
      // entry at stashRef still carries a Conductor label before popping it.
      const msg = await this.gitManager.getStashMessage(result.stashRef);
      if (!msg?.includes("conductor-pre-run-")) {
        throw new RepoInitializerError(
          "STASH_MISMATCH",
          `Stash at ${result.stashRef} doesn't match the expected Conductor stash. Manual intervention required. Expected a message containing "conductor-pre-run-", but found: ${msg ?? "(no stash at this ref)"}`,
        );
      }

      try {
        await this.gitManager.stashPop(result.stashRef);
      } catch (popErr) {
        // Pop conflict: typically the run produced files at the same paths as
        // stashed untracked. DO NOT drop the stash — that would destroy
        // user data. Instead, restore from the disk backup so any untracked
        // file that the run did NOT recreate ends up back on disk, then keep
        // the stash and warn the user.
        const popMessage = popErr instanceof Error ? popErr.message : String(popErr);

        if (result.untrackedBackup && workingDir) {
          try {
            const { restored, skipped } = await this.restoreUntrackedFromBackup(
              workingDir,
              result.untrackedBackup,
            );
            console.warn(
              `[RepoInitializer] git stash pop failed (${popMessage}). ` +
                `Stash kept at ${result.stashRef} (NOT dropped). ` +
                `Restored ${restored.length} file(s) from disk backup; ` +
                `${skipped.length} file(s) were superseded by run output ` +
                `(originals preserved at ${result.untrackedBackup.backupDir}).`,
            );
            // Recovery succeeded — don't throw. User's untracked files are safe.
          } catch (restoreErr) {
            const rMsg = restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
            throw new RepoInitializerError(
              "STASH_POP_FAILED",
              `Stash pop failed AND backup restore failed. Stash kept at ${result.stashRef}, backup at ${result.untrackedBackup.backupDir}. Manual recovery needed.\nPop error: ${popMessage}\nRestore error: ${rMsg}`,
            );
          }
        } else {
          // No untracked backup — conflict is likely from tracked files that
          // the run already committed. Abort the partial apply, drop the stash
          // (run commits are the source of truth), and continue.
          try {
            await this.gitManager.restoreWorkingTree();
            await this.gitManager.stashDrop(result.stashRef);
            console.warn(
              `[RepoInitializer] Stash pop conflict (tracked files). Dropped stash ${result.stashRef} — run commits take precedence.`,
            );
          } catch (dropErr) {
            throw new RepoInitializerError(
              "STASH_POP_FAILED",
              `Stash pop failed and cleanup also failed. Manual recovery needed.\nRun 'git stash drop ${result.stashRef}' manually.\nPop error: ${popMessage}\nDrop error: ${dropErr instanceof Error ? dropErr.message : String(dropErr)}`,
            );
          }
        }
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

  // -------------------------------------------------------------------------
  // Internal: untracked-file backup
  // -------------------------------------------------------------------------

  /**
   * Copies each untracked path (file or directory) into
   * `~/.conductor/untracked-backups/<runId>/`, preserving the relative path
   * structure. Returns the backup descriptor for the result.
   */
  private async backupUntrackedFiles(
    workingDir: string,
    runId: string,
    untrackedPaths: string[],
  ): Promise<UntrackedBackup> {
    const backupDir = getUntrackedBackupDir(runId);
    await mkdir(backupDir, { recursive: true });

    const backedUpPaths: string[] = [];
    for (const relPath of untrackedPaths) {
      // git status returns directory paths with a trailing slash for
      // recursively-untracked dirs. Normalize.
      const cleanRel = relPath.replace(/[/\\]+$/, "");
      const src = join(workingDir, cleanRel);
      const dst = join(backupDir, cleanRel);
      await mkdir(dirname(dst), { recursive: true });
      await cp(src, dst, { recursive: true, errorOnExist: false, force: true });
      backedUpPaths.push(cleanRel);
    }
    return { backupDir, backedUpPaths };
  }

  /**
   * Restores files from a disk backup back into the working tree, but ONLY
   * for paths that don't currently exist on disk. Files the run created at
   * the same paths are left alone (run output wins) — the originals stay
   * preserved in the backup directory for the user to inspect.
   */
  private async restoreUntrackedFromBackup(
    workingDir: string,
    backup: UntrackedBackup,
  ): Promise<{ restored: string[]; skipped: string[] }> {
    const restored: string[] = [];
    const skipped: string[] = [];

    for (const relPath of backup.backedUpPaths) {
      const dst = join(workingDir, relPath);
      const src = join(backup.backupDir, relPath);

      let exists = false;
      try {
        await stat(dst);
        exists = true;
      } catch {
        exists = false;
      }

      if (exists) {
        skipped.push(relPath);
        continue;
      }

      await mkdir(dirname(dst), { recursive: true });
      await cp(src, dst, { recursive: true, errorOnExist: false, force: true });
      restored.push(relPath);
    }

    return { restored, skipped };
  }
}

/**
 * Conductor — Checkpoint Safety Guards
 *
 * Validation rules that MUST NEVER be broken before any destructive git
 * operation. Each guard throws a SafetyGuardError with a machine-readable
 * code so callers can distinguish failure reasons programmatically.
 */

import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class SafetyGuardError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SafetyGuardError";
  }
}

// ---------------------------------------------------------------------------
// Guard 1 — Branch name protection
// ---------------------------------------------------------------------------

/**
 * Throws if `branchName` does not start with `conductor/`.
 *
 * This prevents Conductor from touching the user's own branches (main,
 * feature branches, etc.).  The only exception — passing the original branch
 * that was active when the run started — is handled by the caller: the
 * caller calls this guard only on branches that Conductor itself creates or
 * deletes, and does NOT call it when fast-forward merging back into the
 * original branch.
 */
export function validateNoBranchTouch(branchName: string): void {
  if (!branchName.startsWith("conductor/") || branchName.length <= "conductor/".length) {
    throw new SafetyGuardError(
      "PROTECTED_BRANCH",
      `Cannot modify branch "${branchName}". Only branches starting with "conductor/" (with a non-empty suffix) are allowed.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Guard 2 — Reset target safety
// ---------------------------------------------------------------------------

/**
 * Throws if `targetSha` is not present in `branchHistory`.
 *
 * Prevents `git reset --hard` from jumping to an arbitrary SHA that is
 * outside the current branch, which could silently destroy work.
 */
export function validateResetTarget(targetSha: string, branchHistory: string[]): void {
  if (!branchHistory.includes(targetSha)) {
    throw new SafetyGuardError(
      "UNSAFE_RESET_TARGET",
      `Cannot reset to "${targetSha}": SHA is not in the current branch history. Resetting to a commit outside the branch could destroy work.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Guard 3 — Working directory consistency
// ---------------------------------------------------------------------------

/**
 * Throws if the git command's working directory does not match the directory
 * that was recorded when the run started.
 *
 * Prevents accidental cross-project operations when Conductor is run inside
 * a nested repository or when the cwd changes during a long run.
 */
export function validateWorkingDir(workingDir: string, runWorkingDir: string): void {
  const normalizedActual = resolve(workingDir).toLowerCase();
  const normalizedExpected = resolve(runWorkingDir).toLowerCase();
  if (normalizedActual !== normalizedExpected) {
    throw new SafetyGuardError(
      "WRONG_WORKING_DIR",
      `Git operation attempted in wrong directory.\n  Expected: ${runWorkingDir}\n  Got: ${workingDir}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Guard 4 — Force push prohibition
// ---------------------------------------------------------------------------

/**
 * Always throws. Force-push is never safe without an explicit opt-in from
 * the user; there is no scenario where Conductor should force-push on its
 * own initiative.
 *
 * If force-push ever becomes necessary (e.g. rebasing a Conductor branch on
 * a remote), the caller must obtain explicit user consent and bypass this
 * guard intentionally — never call this guard in that path.
 */
export function validateNoForcePush(): void {
  throw new SafetyGuardError(
    "NO_FORCE_PUSH",
    "Force-push is never permitted. Conductor does not push to remotes without explicit user opt-in. To enable force-push, bypass this guard with explicit user consent.",
  );
}

// ---------------------------------------------------------------------------
// Guard 5 — Fast-forward merge completion
// ---------------------------------------------------------------------------

/**
 * Throws if `actualHeadSha` does not equal `expectedSha`.
 *
 * Call this immediately after a fast-forward merge to confirm that the
 * target branch's HEAD is now the same commit as the source branch tip.
 * If they differ, the merge did not complete and the run branch must NOT
 * be deleted.
 */
export function validateMergeComplete(expectedSha: string, actualHeadSha: string): void {
  if (expectedSha !== actualHeadSha) {
    throw new SafetyGuardError(
      "MERGE_NOT_COMPLETE",
      `Fast-forward merge did not complete correctly. Expected HEAD to be "${expectedSha}" but found "${actualHeadSha}". The run branch will NOT be deleted until the merge is verified.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Guard 6 — Large file detection
// ---------------------------------------------------------------------------

/**
 * Checks every file in `filePaths` and throws if any file exceeds
 * `maxSizeMB` megabytes.
 *
 * Relative paths are resolved against process.cwd(); callers should pass
 * absolute paths when possible.
 */
export async function validateLargeFiles(filePaths: string[], maxSizeMB = 100): Promise<void> {
  const maxBytes = maxSizeMB * 1024 * 1024;
  const offenders: Array<{ path: string; sizeMB: string }> = [];

  await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        // Resolve relative paths against cwd so the error message is useful.
        const resolved = filePath.startsWith(".") ? join(process.cwd(), filePath) : filePath;
        const info = await stat(resolved);
        if (info.size > maxBytes) {
          offenders.push({
            path: filePath,
            sizeMB: (info.size / 1024 / 1024).toFixed(2),
          });
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        // file not found — skip it (deletions are always safe from a size perspective)
      }
    }),
  );

  if (offenders.length > 0) {
    const list = offenders.map((o) => `  • ${o.path} (${o.sizeMB} MB)`).join("\n");
    throw new SafetyGuardError(
      "LARGE_FILES_DETECTED",
      `The following files exceed the ${maxSizeMB} MB limit and must not be committed:\n${list}\nAdd them to .gitignore or reduce their size before continuing.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Named export aggregation (convenience re-export as namespace)
// ---------------------------------------------------------------------------

export const SafetyGuards = {
  validateNoBranchTouch,
  validateResetTarget,
  validateWorkingDir,
  validateNoForcePush,
  validateMergeComplete,
  validateLargeFiles,
} as const;

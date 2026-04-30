/**
 * Conductor — GitManager
 *
 * Low-level wrapper around simple-git that enforces safety guards before
 * every destructive git operation. All public methods call
 * validateWorkingDir first, then delegate to simple-git.
 *
 * Errors from simple-git are wrapped in GitManagerError so callers can
 * distinguish network / git errors from SafetyGuardErrors.
 */

import { type SimpleGit, type StatusResult, simpleGit } from "simple-git";
import { SafetyGuards } from "./safety-guards.js";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class GitManagerError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GitManagerError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrap(operation: string, cause: unknown): GitManagerError {
  const detail = cause instanceof Error ? cause.message : String(cause ?? "unknown error");
  return new GitManagerError(`git ${operation} failed: ${detail}`, cause);
}

// ---------------------------------------------------------------------------
// GitManager
// ---------------------------------------------------------------------------

export class GitManager {
  private readonly git: SimpleGit;

  constructor(
    private readonly workingDir: string,
    private readonly runWorkingDir: string,
  ) {
    this.git = simpleGit(workingDir, {
      config: ["core.autocrlf=true"], // normalize CRLF on Windows
    });
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Assert that this instance is operating on the correct directory. */
  private guard(): void {
    SafetyGuards.validateWorkingDir(this.workingDir, this.runWorkingDir);
  }

  // -------------------------------------------------------------------------
  // Read-only operations
  // -------------------------------------------------------------------------

  /** Returns the name of the currently checked-out branch. */
  async getCurrentBranch(): Promise<string> {
    this.guard();
    try {
      const result = await this.git.revparse(["--abbrev-ref", "HEAD"]);
      return result.trim();
    } catch (err) {
      throw wrap("getCurrentBranch", err);
    }
  }

  /** Returns the full SHA of HEAD. */
  async getHeadSha(): Promise<string> {
    this.guard();
    try {
      const sha = await this.git.revparse(["HEAD"]);
      return sha.trim();
    } catch (err) {
      throw wrap("getHeadSha", err);
    }
  }

  /**
   * Returns the last `count` commits as structured objects.
   * Defaults to 20 entries if count is not provided.
   */
  async getLog(count?: number): Promise<Array<{ hash: string; message: string; date: string }>> {
    this.guard();
    if (count !== undefined && count < 1) {
      throw new GitManagerError("getLog", new Error("count must be >= 1"));
    }
    try {
      const limit = count ?? 20;
      const log = await this.git.log([`-${limit}`]);
      return log.all.map((entry) => ({
        hash: entry.hash,
        message: entry.message,
        date: entry.date,
      }));
    } catch (err) {
      throw wrap("getLog", err);
    }
  }

  /** Returns unified diff between two SHAs. */
  async getDiff(fromSha: string, toSha: string): Promise<string> {
    this.guard();
    try {
      return await this.git.raw(["diff", fromSha, toSha]);
    } catch (err) {
      throw wrap("getDiff", err);
    }
  }

  /** Returns list of changed file paths between two SHAs. */
  async getChangedFiles(fromSha: string, toSha: string): Promise<string[]> {
    this.guard();
    try {
      const raw = await this.git.raw(["diff", "--name-only", fromSha, toSha]);
      return raw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    } catch (err) {
      throw wrap("getChangedFiles", err);
    }
  }

  /** Returns git status (detects dirty working tree). */
  async getStatus(): Promise<StatusResult> {
    this.guard();
    try {
      return await this.git.status();
    } catch (err) {
      throw wrap("getStatus", err);
    }
  }

  /** Returns true if the workingDir is inside a git repository. */
  async isRepo(): Promise<boolean> {
    this.guard();
    try {
      await this.git.revparse(["--git-dir"]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns the full SHAs of all commits reachable from `branchName` but
   * not from its upstream (or all commits if there is no upstream).
   * Used to build the history array for validateResetTarget.
   */
  async getBranchCommits(branchName: string): Promise<string[]> {
    this.guard();
    try {
      const raw = await this.git.raw(["log", "--format=%H", branchName]);
      return raw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    } catch (err) {
      throw wrap("getBranchCommits", err);
    }
  }

  // -------------------------------------------------------------------------
  // Write operations
  // -------------------------------------------------------------------------

  /** Initializes a new git repository in workingDir. */
  async init(): Promise<void> {
    this.guard();
    try {
      await this.git.init();
    } catch (err) {
      throw wrap("init", err);
    }
  }

  /**
   * Creates a new branch. The branch name MUST start with `conductor/`.
   * Throws SafetyGuardError('PROTECTED_BRANCH') otherwise.
   */
  async createBranch(name: string): Promise<void> {
    this.guard();
    SafetyGuards.validateNoBranchTouch(name);
    try {
      await this.git.checkoutLocalBranch(name);
    } catch (err) {
      throw wrap("createBranch", err);
    }
  }

  /** Checks out a branch or SHA (does NOT call validateNoBranchTouch — checkout is non-destructive). */
  async checkout(branchOrSha: string): Promise<void> {
    this.guard();
    try {
      await this.git.checkout(branchOrSha);
    } catch (err) {
      throw wrap("checkout", err);
    }
  }

  /** Stages files for commit. Defaults to staging everything ('.'). */
  async add(paths: string | string[] = "."): Promise<void> {
    this.guard();
    try {
      await this.git.add(paths);
    } catch (err) {
      throw wrap("add", err);
    }
  }

  /**
   * Commits staged changes and returns the new HEAD SHA.
   * Pass `{ allowEmpty: true }` to allow empty commits.
   */
  async commit(message: string, opts?: { allowEmpty?: boolean }): Promise<string> {
    this.guard();
    try {
      const flags: string[] = [];
      if (opts?.allowEmpty) flags.push("--allow-empty");
      await this.git.commit(message, flags);
      return await this.getHeadSha();
    } catch (err) {
      throw wrap("commit", err);
    }
  }

  /**
   * Creates a revert commit for `sha` and returns the new HEAD SHA.
   * Uses `--no-edit` to avoid opening an editor.
   */
  async revert(sha: string): Promise<string> {
    this.guard();
    try {
      await this.git.raw(["revert", "--no-edit", sha]);
      return await this.getHeadSha();
    } catch (err) {
      throw wrap("revert", err);
    }
  }

  /**
   * Resets HEAD to `sha` with `--hard`.
   *
   * SAFETY: validates that `sha` is in `branchHistory` before proceeding.
   * Callers should obtain `branchHistory` via `getBranchCommits`.
   */
  async resetHard(sha: string): Promise<void> {
    this.guard();
    const history = await this.getBranchCommits(await this.getCurrentBranch());
    SafetyGuards.validateResetTarget(sha, history);
    try {
      await this.git.reset(["--hard", sha]);
    } catch (err) {
      throw wrap("resetHard", err);
    }
  }

  /**
   * Fast-forward merges `sourceBranch` into `targetBranch`.
   *
   * - `sourceBranch` must start with `conductor/` (it is the run branch).
   * - `targetBranch` is the user's original branch and is exempt from the
   *   conductor/ prefix check — do NOT call validateNoBranchTouch on it.
   */
  async mergeFastForward(sourceBranch: string, targetBranch: string): Promise<void> {
    this.guard();
    SafetyGuards.validateNoBranchTouch(sourceBranch);
    try {
      await this.git.checkout(targetBranch);
      await this.git.merge(["--ff-only", sourceBranch]);
    } catch (err) {
      throw wrap("mergeFastForward", err);
    }
  }

  /** Creates a lightweight tag pointing to `sha`. */
  async tag(name: string, sha: string): Promise<void> {
    this.guard();
    try {
      await this.git.raw(["tag", name, sha]);
    } catch (err) {
      throw wrap("tag", err);
    }
  }

  /**
   * Stashes the current working tree with an optional message.
   * Pass `includeUntracked: true` to also stash untracked files.
   */
  async stash(message: string, includeUntracked = false): Promise<void> {
    this.guard();
    if (!message.trim()) {
      throw new GitManagerError("stash", new Error("stash message cannot be empty"));
    }
    try {
      const args: string[] = ["push", "-m", message];
      if (includeUntracked) args.push("--include-untracked");
      await this.git.raw(["stash", ...args]);
    } catch (err) {
      throw wrap("stash", err);
    }
  }

  /**
   * Pops a stash entry. If `stashRef` is omitted the most recent stash is
   * used (equivalent to `git stash pop`).
   */
  async stashPop(stashRef?: string): Promise<void> {
    this.guard();
    try {
      const args = stashRef ? ["stash", "pop", stashRef] : ["stash", "pop"];
      await this.git.raw(args);
    } catch (err) {
      throw wrap("stashPop", err);
    }
  }

  /**
   * Returns the stash message for a given stash ref (e.g. "stash@{0}"), or
   * null if no entry exists at that ref.
   *
   * Internally runs `git stash list --format=%gd: %s` and searches for a
   * line that starts with `<ref>:`. This is used by RepoInitializer to
   * verify the correct stash is at stash@{0} before popping it, guarding
   * against the race condition where another process pushes a stash between
   * Conductor's stash and restore.
   */
  async getStashMessage(ref = "stash@{0}"): Promise<string | null> {
    this.guard();
    try {
      const output = await this.git.raw(["stash", "list", "--format=%gd: %s"]);
      const lines = output.split("\n").filter(Boolean);
      const entry = lines.find((l) => l.startsWith(`${ref}:`));
      return entry ? entry.slice(ref.length + 2).trim() : null;
    } catch (err) {
      throw wrap("getStashMessage", err);
    }
  }

  /**
   * Deletes a branch. The branch name MUST start with `conductor/`.
   * Pass `force: true` to use `-D` instead of `-d`.
   */
  async deleteBranch(name: string, force = false): Promise<void> {
    this.guard();
    SafetyGuards.validateNoBranchTouch(name);
    try {
      await this.git.deleteLocalBranch(name, force);
    } catch (err) {
      throw wrap("deleteBranch", err);
    }
  }
}

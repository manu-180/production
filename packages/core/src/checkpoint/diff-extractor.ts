/**
 * Conductor — DiffExtractor
 *
 * Extracts and summarizes git diffs for storage and UI display.
 *
 * The plan stipulates: per checkpoint we store a compact summary in the
 * database (files changed, lines added/removed, file list with statuses)
 * and fetch the full unified diff on demand from git. This module also
 * parses unified-diff text into a structured per-file representation that
 * the UI viewer can render directly.
 */

import type { GitManager } from "./git-manager.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffSummaryFile {
  path: string;
  status: FileStatus;
  linesAdded: number;
  linesRemoved: number;
  /** Only set when status === 'renamed'. */
  oldPath?: string;
}

export interface DiffSummary {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  files: DiffSummaryFile[];
}

export interface DiffHunkLine {
  type: "context" | "add" | "remove";
  content: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffHunkLine[];
}

export interface FileDiff {
  path: string;
  /** For renames: the original path. */
  oldPath?: string;
  status: FileStatus;
  hunks: DiffHunk[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a git name-status code letter to our public FileStatus type.
 * T (type-changed) and C (copied) are treated as 'modified' for UI purposes.
 */
function mapStatusCode(code: string): FileStatus {
  switch (code) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      // T (type changed), C (copied), or anything unexpected → safe fallback.
      return "modified";
  }
}

/** Strips a leading `a/` or `b/` prefix produced by `git diff`. */
function stripPathPrefix(p: string): string {
  if (p.startsWith("a/") || p.startsWith("b/")) return p.slice(2);
  return p;
}

/**
 * Parses a hunk header like `@@ -1,3 +1,4 @@` (counts may be omitted, in
 * which case they default to 1). Returns null if the line is not a valid
 * hunk header.
 */
function parseHunkHeader(line: string): {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
} | null {
  // Pattern: @@ -A[,B] +C[,D] @@ ...
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) return null;
  const oldStart = Number.parseInt(match[1] ?? "0", 10);
  const oldLines = match[2] !== undefined ? Number.parseInt(match[2], 10) : 1;
  const newStart = Number.parseInt(match[3] ?? "0", 10);
  const newLines = match[4] !== undefined ? Number.parseInt(match[4], 10) : 1;
  return { oldStart, oldLines, newStart, newLines };
}

// ---------------------------------------------------------------------------
// DiffExtractor
// ---------------------------------------------------------------------------

export class DiffExtractor {
  constructor(private readonly gitManager: GitManager) {}

  /**
   * Returns a compact summary suitable for DB storage. Uses
   * `git diff --numstat` + `git diff --name-status` under the hood. Total
   * payload stays small (< ~1KB) even for very large changesets.
   */
  async getSummary(fromSha: string, toSha: string): Promise<DiffSummary> {
    const [numstat, nameStatus] = await Promise.all([
      this.gitManager.getNumstat(fromSha, toSha),
      this.gitManager.getNameStatus(fromSha, toSha),
    ]);

    // Index name-status entries by their *new* path for fast lookup.
    const statusByPath = new Map<string, { status: string; oldPath?: string }>();
    for (const entry of nameStatus) {
      statusByPath.set(entry.path, { status: entry.status, oldPath: entry.oldPath });
    }

    const files: DiffSummaryFile[] = [];
    let totalAdded = 0;
    let totalRemoved = 0;

    for (const entry of numstat) {
      const status = statusByPath.get(entry.path);
      const code = status?.status ?? "M";
      const mapped = mapStatusCode(code);

      const file: DiffSummaryFile = {
        path: entry.path,
        status: mapped,
        linesAdded: entry.added,
        linesRemoved: entry.removed,
      };
      if (mapped === "renamed" && status?.oldPath !== undefined) {
        file.oldPath = status.oldPath;
      }
      files.push(file);

      totalAdded += entry.added;
      totalRemoved += entry.removed;
    }

    return {
      filesChanged: files.length,
      linesAdded: totalAdded,
      linesRemoved: totalRemoved,
      files,
    };
  }

  /**
   * Returns the full unified diff for the given range. Used by the UI
   * on-demand. Output can be large — do not persist this in the DB.
   */
  async getFullDiff(fromSha: string, toSha: string): Promise<string> {
    return this.gitManager.getDiff(fromSha, toSha);
  }

  /**
   * Parses a unified-diff string into structured per-file changes.
   * Used by the UI to render the diff viewer.
   *
   * Handles: added/deleted/renamed/modified files, multiple hunks, hunks
   * without explicit counts (`@@ -1 +1 @@`), binary file markers, and
   * pure-rename entries (no hunks).
   */
  parseUnifiedDiff(diffText: string): FileDiff[] {
    if (diffText.length === 0) return [];

    const lines = diffText.split("\n");
    const files: FileDiff[] = [];

    let current: FileDiff | null = null;
    let currentHunk: DiffHunk | null = null;
    // Path candidates accumulated from header lines for the current file.
    let pendingOldPath: string | undefined;
    let pendingNewPath: string | undefined;
    let pendingStatus: FileStatus = "modified";
    let pendingRenameFrom: string | undefined;
    let pendingRenameTo: string | undefined;

    const finalizeFile = (): void => {
      if (current === null) return;

      // Resolve final path / oldPath / status based on accumulated headers.
      if (pendingRenameTo !== undefined && pendingRenameFrom !== undefined) {
        current.status = "renamed";
        current.path = pendingRenameTo;
        current.oldPath = pendingRenameFrom;
      } else if (pendingStatus === "added") {
        current.status = "added";
        current.path = pendingNewPath ?? current.path;
      } else if (pendingStatus === "deleted") {
        current.status = "deleted";
        current.path = pendingOldPath ?? current.path;
      } else {
        current.status = pendingStatus;
        current.path = pendingNewPath ?? pendingOldPath ?? current.path;
      }

      if (currentHunk !== null) {
        current.hunks.push(currentHunk);
      }

      files.push(current);
      current = null;
      currentHunk = null;
      pendingOldPath = undefined;
      pendingNewPath = undefined;
      pendingStatus = "modified";
      pendingRenameFrom = undefined;
      pendingRenameTo = undefined;
    };

    for (const line of lines) {
      // ---------------------------------------------------------------------
      // File boundary
      // ---------------------------------------------------------------------
      if (line.startsWith("diff --git ")) {
        finalizeFile();
        // Parse "diff --git a/path b/path" — used as a fallback path source
        // when neither --- / +++ nor rename headers are present (e.g. pure
        // mode changes or binary-only diffs).
        const headerMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
        const fallbackOld = headerMatch?.[1];
        const fallbackNew = headerMatch?.[2];
        current = {
          path: fallbackNew ?? fallbackOld ?? "",
          status: "modified",
          hunks: [],
        };
        pendingOldPath = fallbackOld;
        pendingNewPath = fallbackNew;
        continue;
      }

      if (current === null) {
        // Ignore preamble before the first `diff --git` header.
        continue;
      }

      // ---------------------------------------------------------------------
      // File-level metadata headers (before any hunks)
      // ---------------------------------------------------------------------
      if (currentHunk === null) {
        if (line.startsWith("new file mode")) {
          pendingStatus = "added";
          continue;
        }
        if (line.startsWith("deleted file mode")) {
          pendingStatus = "deleted";
          continue;
        }
        if (line.startsWith("rename from ")) {
          pendingRenameFrom = line.slice("rename from ".length);
          continue;
        }
        if (line.startsWith("rename to ")) {
          pendingRenameTo = line.slice("rename to ".length);
          continue;
        }
        if (line.startsWith("--- ")) {
          const p = line.slice(4);
          if (p === "/dev/null") {
            pendingStatus = "added";
          } else {
            pendingOldPath = stripPathPrefix(p);
          }
          continue;
        }
        if (line.startsWith("+++ ")) {
          const p = line.slice(4);
          if (p === "/dev/null") {
            pendingStatus = "deleted";
          } else {
            pendingNewPath = stripPathPrefix(p);
          }
          continue;
        }
        // Binary marker — record nothing extra; finalizeFile will use the
        // paths from `diff --git`.
        if (line.startsWith("Binary files ")) {
          continue;
        }
        // similarity index, index <hash>..<hash>, mode lines etc → ignore.
      }

      // ---------------------------------------------------------------------
      // Hunk header
      // ---------------------------------------------------------------------
      if (line.startsWith("@@")) {
        if (currentHunk !== null) {
          current.hunks.push(currentHunk);
        }
        const parsed = parseHunkHeader(line);
        if (parsed !== null) {
          currentHunk = { ...parsed, lines: [] };
        } else {
          currentHunk = null;
        }
        continue;
      }

      // ---------------------------------------------------------------------
      // Hunk body
      // ---------------------------------------------------------------------
      if (currentHunk !== null) {
        if (line.startsWith("\\")) {
          // "\ No newline at end of file" — skip.
          continue;
        }
        if (line.startsWith("+")) {
          currentHunk.lines.push({ type: "add", content: line.slice(1) });
          continue;
        }
        if (line.startsWith("-")) {
          currentHunk.lines.push({ type: "remove", content: line.slice(1) });
          continue;
        }
        if (line.startsWith(" ")) {
          currentHunk.lines.push({ type: "context", content: line.slice(1) });
          continue;
        }
        // Empty line inside a hunk (some git outputs emit a bare empty line
        // for an empty context line) → treat as empty context.
        if (line.length === 0) {
          currentHunk.lines.push({ type: "context", content: "" });
        }
      }
    }

    finalizeFile();
    return files;
  }
}

/**
 * Unit tests for DiffExtractor.
 *
 * GitManager is mocked via vi.fn(). Each test constructs a minimal mock
 * that satisfies only the methods exercised by the code path under test.
 */

import { describe, expect, it, vi } from "vitest";
import { DiffExtractor } from "../diff-extractor.js";
import type { GitManager } from "../git-manager.js";

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makeMockGitManager(
  overrides: Partial<Record<keyof GitManager, unknown>> = {},
): GitManager {
  return {
    getNumstat: vi.fn().mockResolvedValue([]),
    getNameStatus: vi.fn().mockResolvedValue([]),
    getDiff: vi.fn().mockResolvedValue(""),
    ...overrides,
  } as unknown as GitManager;
}

// ---------------------------------------------------------------------------
// getSummary
// ---------------------------------------------------------------------------

describe("DiffExtractor.getSummary", () => {
  it("summarizes a single modified file", async () => {
    const git = makeMockGitManager({
      getNumstat: vi.fn().mockResolvedValue([{ added: 5, removed: 2, path: "foo.ts" }]),
      getNameStatus: vi.fn().mockResolvedValue([{ status: "M", path: "foo.ts" }]),
    });
    const extractor = new DiffExtractor(git);

    const summary = await extractor.getSummary("from", "to");

    expect(summary.filesChanged).toBe(1);
    expect(summary.linesAdded).toBe(5);
    expect(summary.linesRemoved).toBe(2);
    expect(summary.files).toEqual([
      { path: "foo.ts", status: "modified", linesAdded: 5, linesRemoved: 2 },
    ]);
  });

  it("classifies a newly added file", async () => {
    const git = makeMockGitManager({
      getNumstat: vi.fn().mockResolvedValue([{ added: 12, removed: 0, path: "new.ts" }]),
      getNameStatus: vi.fn().mockResolvedValue([{ status: "A", path: "new.ts" }]),
    });
    const extractor = new DiffExtractor(git);

    const summary = await extractor.getSummary("from", "to");

    expect(summary.files[0]).toEqual({
      path: "new.ts",
      status: "added",
      linesAdded: 12,
      linesRemoved: 0,
    });
    expect(summary.linesAdded).toBe(12);
    expect(summary.linesRemoved).toBe(0);
  });

  it("classifies a deleted file", async () => {
    const git = makeMockGitManager({
      getNumstat: vi.fn().mockResolvedValue([{ added: 0, removed: 30, path: "gone.ts" }]),
      getNameStatus: vi.fn().mockResolvedValue([{ status: "D", path: "gone.ts" }]),
    });
    const extractor = new DiffExtractor(git);

    const summary = await extractor.getSummary("from", "to");

    expect(summary.files[0]).toEqual({
      path: "gone.ts",
      status: "deleted",
      linesAdded: 0,
      linesRemoved: 30,
    });
  });

  it("classifies a renamed file and includes oldPath", async () => {
    const git = makeMockGitManager({
      getNumstat: vi.fn().mockResolvedValue([{ added: 1, removed: 1, path: "new.ts" }]),
      getNameStatus: vi
        .fn()
        .mockResolvedValue([{ status: "R", path: "new.ts", oldPath: "old.ts" }]),
    });
    const extractor = new DiffExtractor(git);

    const summary = await extractor.getSummary("from", "to");

    expect(summary.files[0]).toEqual({
      path: "new.ts",
      status: "renamed",
      linesAdded: 1,
      linesRemoved: 1,
      oldPath: "old.ts",
    });
  });

  it("aggregates totals across mixed statuses", async () => {
    const git = makeMockGitManager({
      getNumstat: vi.fn().mockResolvedValue([
        { added: 10, removed: 0, path: "added.ts" },
        { added: 5, removed: 3, path: "modified.ts" },
        { added: 0, removed: 20, path: "deleted.ts" },
      ]),
      getNameStatus: vi.fn().mockResolvedValue([
        { status: "A", path: "added.ts" },
        { status: "M", path: "modified.ts" },
        { status: "D", path: "deleted.ts" },
      ]),
    });
    const extractor = new DiffExtractor(git);

    const summary = await extractor.getSummary("from", "to");

    expect(summary.filesChanged).toBe(3);
    expect(summary.linesAdded).toBe(15);
    expect(summary.linesRemoved).toBe(23);
    expect(summary.files.map((f) => f.status)).toEqual(["added", "modified", "deleted"]);
  });

  it("treats binary files (numstat '-') as 0 line changes", async () => {
    // Numstat already-normalized in GitManager.getNumstat: '-' becomes 0.
    // We just verify DiffExtractor passes through correctly.
    const git = makeMockGitManager({
      getNumstat: vi.fn().mockResolvedValue([{ added: 0, removed: 0, path: "image.png" }]),
      getNameStatus: vi.fn().mockResolvedValue([{ status: "M", path: "image.png" }]),
    });
    const extractor = new DiffExtractor(git);

    const summary = await extractor.getSummary("from", "to");

    expect(summary.files[0]).toEqual({
      path: "image.png",
      status: "modified",
      linesAdded: 0,
      linesRemoved: 0,
    });
    expect(summary.linesAdded).toBe(0);
    expect(summary.linesRemoved).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getFullDiff
// ---------------------------------------------------------------------------

describe("DiffExtractor.getFullDiff", () => {
  it("delegates to gitManager.getDiff", async () => {
    const getDiff = vi.fn().mockResolvedValue("DIFF-OUTPUT");
    const git = makeMockGitManager({ getDiff });
    const extractor = new DiffExtractor(git);

    const result = await extractor.getFullDiff("sha-a", "sha-b");

    expect(result).toBe("DIFF-OUTPUT");
    expect(getDiff).toHaveBeenCalledWith("sha-a", "sha-b");
  });
});

// ---------------------------------------------------------------------------
// parseUnifiedDiff
// ---------------------------------------------------------------------------

describe("DiffExtractor.parseUnifiedDiff", () => {
  const extractor = new DiffExtractor(makeMockGitManager());

  it("returns [] for empty input", () => {
    expect(extractor.parseUnifiedDiff("")).toEqual([]);
  });

  it("parses a simple modification with mixed context/add/remove lines", () => {
    const diff = [
      "diff --git a/foo.ts b/foo.ts",
      "index 1234567..89abcde 100644",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,3 +1,4 @@",
      " context-line-1",
      "-removed-line",
      "+added-line-1",
      "+added-line-2",
      " context-line-2",
    ].join("\n");

    const result = extractor.parseUnifiedDiff(diff);

    expect(result).toHaveLength(1);
    const file = result[0];
    expect(file).toBeDefined();
    if (!file) return;
    expect(file.path).toBe("foo.ts");
    expect(file.status).toBe("modified");
    expect(file.hunks).toHaveLength(1);
    const hunk = file.hunks[0];
    expect(hunk).toBeDefined();
    if (!hunk) return;
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldLines).toBe(3);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newLines).toBe(4);
    expect(hunk.lines).toEqual([
      { type: "context", content: "context-line-1" },
      { type: "remove", content: "removed-line" },
      { type: "add", content: "added-line-1" },
      { type: "add", content: "added-line-2" },
      { type: "context", content: "context-line-2" },
    ]);
  });

  it("detects a new file (--- /dev/null)", () => {
    const diff = [
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "index 0000000..abc1234",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1,2 @@",
      "+line 1",
      "+line 2",
    ].join("\n");

    const result = extractor.parseUnifiedDiff(diff);

    expect(result).toHaveLength(1);
    const file = result[0];
    expect(file).toBeDefined();
    if (!file) return;
    expect(file.status).toBe("added");
    expect(file.path).toBe("new.ts");
  });

  it("detects a deleted file (+++ /dev/null)", () => {
    const diff = [
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "index abc1234..0000000",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-line 1",
      "-line 2",
    ].join("\n");

    const result = extractor.parseUnifiedDiff(diff);

    expect(result).toHaveLength(1);
    const file = result[0];
    expect(file).toBeDefined();
    if (!file) return;
    expect(file.status).toBe("deleted");
    expect(file.path).toBe("gone.ts");
  });

  it("detects a renamed file and sets oldPath", () => {
    const diff = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 100%",
      "rename from old.ts",
      "rename to new.ts",
    ].join("\n");

    const result = extractor.parseUnifiedDiff(diff);

    expect(result).toHaveLength(1);
    const file = result[0];
    expect(file).toBeDefined();
    if (!file) return;
    expect(file.status).toBe("renamed");
    expect(file.path).toBe("new.ts");
    expect(file.oldPath).toBe("old.ts");
    expect(file.hunks).toHaveLength(0);
  });

  it("parses multiple file sections in a single diff", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "index 111..222 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      "-old A",
      "+new A",
      "diff --git a/b.ts b/b.ts",
      "index 333..444 100644",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1,1 +1,1 @@",
      "-old B",
      "+new B",
      "diff --git a/c.ts b/c.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/c.ts",
      "@@ -0,0 +1,1 @@",
      "+brand new",
    ].join("\n");

    const result = extractor.parseUnifiedDiff(diff);

    expect(result).toHaveLength(3);
    expect(result.map((f) => f.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(result.map((f) => f.status)).toEqual(["modified", "modified", "added"]);
  });

  it("handles a hunk header without explicit line counts (@@ -1 +1 @@)", () => {
    const diff = [
      "diff --git a/foo.ts b/foo.ts",
      "index 111..222 100644",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const result = extractor.parseUnifiedDiff(diff);

    const file = result[0];
    expect(file).toBeDefined();
    if (!file) return;
    const hunk = file.hunks[0];
    expect(hunk).toBeDefined();
    if (!hunk) return;
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldLines).toBe(1);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newLines).toBe(1);
  });

  it("captures multiple hunks per file in order", () => {
    const diff = [
      "diff --git a/big.ts b/big.ts",
      "index 111..222 100644",
      "--- a/big.ts",
      "+++ b/big.ts",
      "@@ -1,2 +1,2 @@",
      " context-A",
      "-old-A",
      "+new-A",
      "@@ -10,2 +10,2 @@",
      " context-B",
      "-old-B",
      "+new-B",
      "@@ -50,1 +50,2 @@",
      " context-C",
      "+added-C",
    ].join("\n");

    const result = extractor.parseUnifiedDiff(diff);

    const file = result[0];
    expect(file).toBeDefined();
    if (!file) return;
    expect(file.hunks).toHaveLength(3);
    expect(file.hunks.map((h) => h.oldStart)).toEqual([1, 10, 50]);
    const firstHunk = file.hunks[0];
    const lastHunk = file.hunks[2];
    expect(firstHunk).toBeDefined();
    expect(lastHunk).toBeDefined();
    if (!firstHunk || !lastHunk) return;
    expect(firstHunk.lines).toEqual([
      { type: "context", content: "context-A" },
      { type: "remove", content: "old-A" },
      { type: "add", content: "new-A" },
    ]);
    expect(lastHunk.lines).toEqual([
      { type: "context", content: "context-C" },
      { type: "add", content: "added-C" },
    ]);
  });
});

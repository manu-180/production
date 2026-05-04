/**
 * Unit tests for RepoInitializer.
 *
 * GitManager is fully mocked via vi.fn() so these tests run without a real
 * git repository on disk. Each test constructs a minimal mock that satisfies
 * only the methods invoked by the code path under test.
 *
 * node:fs/promises is also mocked so the auto-init path (which writes
 * .gitignore) does not require a real working directory on disk.
 */

import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:fs/promises so writeFile doesn't hit the real FS
// ---------------------------------------------------------------------------
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

import type { GitManager } from "../git-manager.js";
import { RepoInitializer, RepoInitializerError } from "../repo-initializer.js";

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

const CLEAN_STATUS = {
  files: [],
  modified: [],
  created: [],
  deleted: [],
  renamed: [],
  conflicted: [],
  staged: [],
  not_added: [],
};

const DIRTY_STATUS = {
  ...CLEAN_STATUS,
  files: [{ path: "foo.ts", index: "M", working_dir: " " }],
  modified: ["foo.ts"],
};

function makeMockGitManager(
  overrides: Partial<Record<keyof GitManager, unknown>> = {},
): GitManager {
  return {
    isRepo: vi.fn().mockResolvedValue(true),
    init: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue("abc123"),
    getCurrentBranch: vi.fn().mockResolvedValue("main"),
    getHeadSha: vi.fn().mockResolvedValue("deadbeef"),
    getStatus: vi.fn().mockResolvedValue(CLEAN_STATUS),
    stash: vi.fn().mockResolvedValue(undefined),
    stashPop: vi.fn().mockResolvedValue(undefined),
    stashDrop: vi.fn().mockResolvedValue(undefined),
    restoreWorkingTree: vi.fn().mockResolvedValue(undefined),
    checkout: vi.fn().mockResolvedValue(undefined),
    getStashMessage: vi.fn().mockResolvedValue("conductor-pre-run-run123"),
    ...overrides,
  } as unknown as GitManager;
}

// ---------------------------------------------------------------------------
// initForRun tests
// ---------------------------------------------------------------------------

describe("RepoInitializer.initForRun", () => {
  const WORKING_DIR = "/fake/working/dir";
  const RUN_ID = "run123";

  it("returns correct result for a clean repo with default options", async () => {
    const mock = makeMockGitManager();
    const initializer = new RepoInitializer(mock);

    const result = await initializer.initForRun(WORKING_DIR, RUN_ID);

    expect(result).toEqual({
      wasInitialized: false,
      wasStashed: false,
      stashRef: null,
      originalBranch: "main",
      baseSha: "deadbeef",
      untrackedBackup: null,
    });
    expect(mock.init).not.toHaveBeenCalled();
    expect(mock.stash).not.toHaveBeenCalled();
  });

  it("auto-initializes when not a repo and autoInitGit is default (true)", async () => {
    const mock = makeMockGitManager({
      isRepo: vi.fn().mockResolvedValue(false),
    });
    const initializer = new RepoInitializer(mock);

    const result = await initializer.initForRun(WORKING_DIR, RUN_ID);

    expect(mock.init).toHaveBeenCalledOnce();
    expect(mock.add).toHaveBeenCalledWith(".");
    expect(mock.commit).toHaveBeenCalledWith("chore: initial commit by Conductor", {
      allowEmpty: true,
    });
    expect(result.wasInitialized).toBe(true);
    expect(result.wasStashed).toBe(false);
  });

  it("throws WORKING_DIR_NOT_GIT_REPO when not a repo and autoInitGit: false", async () => {
    const mock = makeMockGitManager({
      isRepo: vi.fn().mockResolvedValue(false),
    });
    const initializer = new RepoInitializer(mock);

    await expect(
      initializer.initForRun(WORKING_DIR, RUN_ID, { autoInitGit: false }),
    ).rejects.toThrow(RepoInitializerError);

    try {
      await initializer.initForRun(WORKING_DIR, RUN_ID, { autoInitGit: false });
    } catch (err) {
      expect(err).toBeInstanceOf(RepoInitializerError);
      expect((err as RepoInitializerError).code).toBe("WORKING_DIR_NOT_GIT_REPO");
    }
  });

  it("stashes dirty working tree with correct label when autoStash is default (true)", async () => {
    const mock = makeMockGitManager({
      getStatus: vi.fn().mockResolvedValue(DIRTY_STATUS),
    });
    const initializer = new RepoInitializer(mock);

    const result = await initializer.initForRun(WORKING_DIR, RUN_ID);

    expect(mock.stash).toHaveBeenCalledWith(`conductor-pre-run-${RUN_ID}`, true);
    expect(result.wasStashed).toBe(true);
    expect(result.stashRef).toBe("stash@{0}");
  });

  it("throws DIRTY_WORKING_TREE when dirty and autoStash: false", async () => {
    const mock = makeMockGitManager({
      getStatus: vi.fn().mockResolvedValue(DIRTY_STATUS),
    });
    const initializer = new RepoInitializer(mock);

    await expect(initializer.initForRun(WORKING_DIR, RUN_ID, { autoStash: false })).rejects.toThrow(
      RepoInitializerError,
    );

    try {
      await initializer.initForRun(WORKING_DIR, RUN_ID, { autoStash: false });
    } catch (err) {
      expect(err).toBeInstanceOf(RepoInitializerError);
      expect((err as RepoInitializerError).code).toBe("DIRTY_WORKING_TREE");
    }
  });
});

// ---------------------------------------------------------------------------
// restoreAfterRun tests
// ---------------------------------------------------------------------------

describe("RepoInitializer.restoreAfterRun", () => {
  const BASE_RESULT = {
    wasInitialized: false,
    wasStashed: false,
    stashRef: null as string | null,
    originalBranch: "main",
    baseSha: "deadbeef",
    untrackedBackup: null,
  };

  it("calls getStashMessage, stashPop, and checkout when wasStashed is true", async () => {
    const mock = makeMockGitManager();
    const initializer = new RepoInitializer(mock);

    await initializer.restoreAfterRun({
      ...BASE_RESULT,
      wasStashed: true,
      stashRef: "stash@{0}",
    });

    expect(mock.getStashMessage).toHaveBeenCalledWith("stash@{0}");
    expect(mock.stashPop).toHaveBeenCalledWith("stash@{0}");
    expect(mock.checkout).toHaveBeenCalledWith("main");
  });

  it("only calls checkout when wasStashed is false", async () => {
    const mock = makeMockGitManager();
    const initializer = new RepoInitializer(mock);

    await initializer.restoreAfterRun(BASE_RESULT);

    expect(mock.getStashMessage).not.toHaveBeenCalled();
    expect(mock.stashPop).not.toHaveBeenCalled();
    expect(mock.checkout).toHaveBeenCalledWith("main");
  });

  it("throws STASH_MISMATCH when stash message does not contain 'conductor-pre-run-'", async () => {
    const mock = makeMockGitManager({
      getStashMessage: vi.fn().mockResolvedValue("some-other-stash"),
    });
    const initializer = new RepoInitializer(mock);

    await expect(
      initializer.restoreAfterRun({ ...BASE_RESULT, wasStashed: true, stashRef: "stash@{0}" }),
    ).rejects.toThrow(RepoInitializerError);

    try {
      await initializer.restoreAfterRun({
        ...BASE_RESULT,
        wasStashed: true,
        stashRef: "stash@{0}",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(RepoInitializerError);
      expect((err as RepoInitializerError).code).toBe("STASH_MISMATCH");
    }
  });

  it("throws STASH_MISMATCH when stash message is null (no stash at ref)", async () => {
    const mock = makeMockGitManager({
      getStashMessage: vi.fn().mockResolvedValue(null),
    });
    const initializer = new RepoInitializer(mock);

    try {
      await initializer.restoreAfterRun({
        ...BASE_RESULT,
        wasStashed: true,
        stashRef: "stash@{0}",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(RepoInitializerError);
      expect((err as RepoInitializerError).code).toBe("STASH_MISMATCH");
    }
  });

  it("drops stash and continues to checkout when stashPop fails on tracked-file conflict (no untracked backup)", async () => {
    const stashDropMock = vi.fn().mockResolvedValue(undefined);
    const restoreWorkingTreeMock = vi.fn().mockResolvedValue(undefined);
    const mock = makeMockGitManager({
      stashPop: vi.fn().mockRejectedValue(new Error("merge conflict on pop")),
      stashDrop: stashDropMock,
      restoreWorkingTree: restoreWorkingTreeMock,
    });
    const initializer = new RepoInitializer(mock);

    // No untrackedBackup — tracked-file conflict path
    await initializer.restoreAfterRun({
      ...BASE_RESULT,
      wasStashed: true,
      stashRef: "stash@{0}",
    });

    expect(restoreWorkingTreeMock).toHaveBeenCalledOnce();
    expect(stashDropMock).toHaveBeenCalledWith("stash@{0}");
    // checkout to original branch still happens
    expect(mock.checkout).toHaveBeenCalledWith("main");
  });

  it("throws STASH_POP_FAILED when stashPop fails and cleanup also fails", async () => {
    const mock = makeMockGitManager({
      stashPop: vi.fn().mockRejectedValue(new Error("merge conflict on pop")),
      restoreWorkingTree: vi.fn().mockResolvedValue(undefined),
      stashDrop: vi.fn().mockRejectedValue(new Error("stash drop failed")),
    });
    const initializer = new RepoInitializer(mock);

    await expect(
      initializer.restoreAfterRun({ ...BASE_RESULT, wasStashed: true, stashRef: "stash@{0}" }),
    ).rejects.toThrow(RepoInitializerError);

    try {
      await initializer.restoreAfterRun({
        ...BASE_RESULT,
        wasStashed: true,
        stashRef: "stash@{0}",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(RepoInitializerError);
      expect((err as RepoInitializerError).code).toBe("STASH_POP_FAILED");
      expect((err as RepoInitializerError).message).toContain("merge conflict on pop");
      expect((err as RepoInitializerError).message).toContain("stash drop failed");
    }
  });

  it("does NOT throw when stashPop fails but untrackedBackup is present (data recovery path)", async () => {
    const mock = makeMockGitManager({
      stashPop: vi.fn().mockRejectedValue(new Error("untracked files would be overwritten")),
    });
    const initializer = new RepoInitializer(mock);

    // Provide a fake backup. The backup directory will not actually exist on
    // disk, so cp will fail — but the test asserts that we DO NOT auto-throw
    // STASH_POP_FAILED and we DO NOT auto-drop the stash. (Drop must never be
    // called automatically — that path destroyed user data before.)
    const fakeBackup = {
      backupDir: "/tmp/fake-backup",
      backedUpPaths: [] as string[], // empty → restore loop is a no-op, no FS touch
    };

    await initializer.restoreAfterRun(
      {
        ...BASE_RESULT,
        wasStashed: true,
        stashRef: "stash@{0}",
        untrackedBackup: fakeBackup,
      },
      "/fake/working/dir",
    );

    // stash drop must never be called in the untracked-backup path — the
    // original bug auto-dropped and permanently destroyed user files.
    expect(mock.stashDrop).not.toHaveBeenCalled();
    // checkout to original branch still happens.
    expect(mock.checkout).toHaveBeenCalledWith("main");
  });

  it("throws CHECKOUT_FAILED when checkout rejects", async () => {
    const mock = makeMockGitManager({
      checkout: vi.fn().mockRejectedValue(new Error("branch not found")),
    });
    const initializer = new RepoInitializer(mock);

    await expect(initializer.restoreAfterRun(BASE_RESULT)).rejects.toThrow(RepoInitializerError);

    try {
      await initializer.restoreAfterRun(BASE_RESULT);
    } catch (err) {
      expect(err).toBeInstanceOf(RepoInitializerError);
      expect((err as RepoInitializerError).code).toBe("CHECKOUT_FAILED");
      expect((err as RepoInitializerError).message).toContain("main");
      expect((err as RepoInitializerError).message).toContain("branch not found");
    }
  });
});

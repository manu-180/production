/**
 * Unit tests for CheckpointManager.
 *
 * GitManager is fully mocked via vi.fn() so these tests run without a real
 * git repository on disk. Each test constructs a minimal mock that satisfies
 * only the methods invoked by the code path under test.
 */

import { describe, expect, it, vi } from "vitest";
import {
  CheckpointManager,
  CheckpointManagerError,
  type PromptMetadata,
} from "../checkpoint-manager.js";
import type { GitManager } from "../git-manager.js";

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makeMockGitManager(
  overrides: Partial<Record<keyof GitManager, unknown>> = {},
): GitManager {
  return {
    createBranch: vi.fn().mockResolvedValue(undefined),
    checkout: vi.fn().mockResolvedValue(undefined),
    getHeadSha: vi.fn().mockResolvedValue("sha-base-0001"),
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue("sha-base-0001"),
    resetHard: vi.fn().mockResolvedValue(undefined),
    mergeFastForward: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    getDiff: vi.fn().mockResolvedValue("diff output"),
    getBranchCommits: vi.fn().mockResolvedValue(["sha-base-0001"]),
    getCurrentBranch: vi.fn().mockResolvedValue("conductor/run-testruni"),
    ...overrides,
  } as unknown as GitManager;
}

const BASE_PROMPT_META: PromptMetadata = {
  title: "Setup database",
  filename: "01-setup-db.md",
  order: 1,
  total: 3,
};

const BASE_EXEC_META = {
  tokensIn: 1000,
  tokensOut: 500,
  tokensCache: 200,
  costUsd: 0.005,
  durationMs: 3000,
  toolsUsed: ["bash", "read_file"],
  guardianDecisions: 1,
};

// First 8 chars of this runId = "testruni" → branch = "conductor/run-testruni"
const RUN_ID = "testruni-full-uuid-here";
const WORKING_DIR = "/fake/project";

// ---------------------------------------------------------------------------
// initRun
// ---------------------------------------------------------------------------

describe("CheckpointManager.initRun", () => {
  it("creates a branch with correct name (first 8 chars of runId)", async () => {
    const mock = makeMockGitManager();
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);

    await manager.initRun("main");

    expect(mock.createBranch).toHaveBeenCalledOnce();
    expect(mock.createBranch).toHaveBeenCalledWith("conductor/run-testruni");
  });

  it("returns the correct RunInitResult shape", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockResolvedValue("abc123ff"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);

    const result = await manager.initRun("main");

    expect(result).toEqual({
      runBranch: "conductor/run-testruni",
      baseSha: "abc123ff",
    });
  });

  it("calls getHeadSha after createBranch to record baseSha", async () => {
    const calls: string[] = [];
    const mock = makeMockGitManager({
      createBranch: vi.fn().mockImplementation(async () => {
        calls.push("createBranch");
      }),
      getHeadSha: vi.fn().mockImplementation(async () => {
        calls.push("getHeadSha");
        return "sha-after-branch";
      }),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);

    await manager.initRun("main");

    expect(calls).toEqual(["createBranch", "getHeadSha"]);
  });
});

// ---------------------------------------------------------------------------
// commit — with promptMeta and execMeta
// ---------------------------------------------------------------------------

describe("CheckpointManager.commit — with promptMeta and execMeta", () => {
  it("calls add('.') before commit", async () => {
    const mock = makeMockGitManager({
      commit: vi.fn().mockResolvedValue("sha-after-commit-1"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    manager.setPromptMeta("prompt-1", BASE_PROMPT_META);
    manager.setExecutionMeta("prompt-1", BASE_EXEC_META);

    await manager.commit("prompt-1", "exec-001");

    expect(mock.add).toHaveBeenCalledWith(".");
  });

  it("calls gitManager.commit with a formatted message including runId prefix", async () => {
    const mock = makeMockGitManager({
      commit: vi.fn().mockResolvedValue("sha-after-commit-1"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    manager.setPromptMeta("prompt-1", BASE_PROMPT_META);
    manager.setExecutionMeta("prompt-1", BASE_EXEC_META);

    await manager.commit("prompt-1", "exec-001");

    expect(mock.commit).toHaveBeenCalledOnce();
    const lastCommitCall = (mock.commit as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastCommitCall).toBeDefined();
    const [message] = lastCommitCall as [string, unknown];
    expect(message).toContain("conductor(run-testruni):");
    expect(message).toContain("Setup database");
  });

  it("always passes { allowEmpty: true } to gitManager.commit", async () => {
    const mock = makeMockGitManager({
      commit: vi.fn().mockResolvedValue("sha-001"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    manager.setPromptMeta("prompt-1", BASE_PROMPT_META);
    manager.setExecutionMeta("prompt-1", BASE_EXEC_META);

    await manager.commit("prompt-1", "exec-001");

    const lastCommitCall = (mock.commit as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastCommitCall).toBeDefined();
    const [, opts] = lastCommitCall as [string, { allowEmpty: boolean }];
    expect(opts).toEqual({ allowEmpty: true });
  });

  it("returns the SHA from gitManager.commit()", async () => {
    const mock = makeMockGitManager({
      commit: vi.fn().mockResolvedValue("sha-prompt-1"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    manager.setPromptMeta("prompt-1", BASE_PROMPT_META);
    manager.setExecutionMeta("prompt-1", BASE_EXEC_META);

    const sha = await manager.commit("prompt-1", "exec-001");

    expect(sha).toBe("sha-prompt-1");
  });

  it("records the checkpoint entry in getCheckpoints()", async () => {
    const mock = makeMockGitManager({
      commit: vi.fn().mockResolvedValue("sha-prompt-1"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    manager.setPromptMeta("prompt-1", BASE_PROMPT_META);
    manager.setExecutionMeta("prompt-1", BASE_EXEC_META);

    await manager.commit("prompt-1", "exec-001");

    const checkpoints = await manager.getCheckpoints();
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]?.promptId).toBe("prompt-1");
    expect(checkpoints[0]?.executionId).toBe("exec-001");
    expect(checkpoints[0]?.sha).toBe("sha-prompt-1");
  });

  it("uses the SHA returned by gitManager.commit, not a separate getHeadSha call", async () => {
    // Verifies the state-drift fix: if getHeadSha throws after commit, commit()
    // must still succeed because it relies on the SHA returned by gitManager.commit.
    const mock = makeMockGitManager({
      commit: vi.fn().mockResolvedValue("abc"),
      getHeadSha: vi
        .fn()
        .mockResolvedValueOnce("sha-base") // initRun call
        .mockRejectedValue(new Error("getHeadSha must not be called during commit")),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    manager.setPromptMeta("prompt-1", BASE_PROMPT_META);
    manager.setExecutionMeta("prompt-1", BASE_EXEC_META);

    const sha = await manager.commit("prompt-1", "exec-001");
    expect(sha).toBe("abc");

    // Confirm the recorded checkpoint also uses the commit-returned SHA.
    const checkpoints = await manager.getCheckpoints();
    expect(checkpoints[0]?.sha).toBe("abc");
  });
});

// ---------------------------------------------------------------------------
// commit — without promptMeta (fallback message)
// ---------------------------------------------------------------------------

describe("CheckpointManager.commit — without promptMeta (fallback)", () => {
  it("still commits successfully when no promptMeta is set", async () => {
    const mock = makeMockGitManager({
      commit: vi.fn().mockResolvedValue("sha-fallback"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    // No setPromptMeta or setExecutionMeta calls.
    const sha = await manager.commit("prompt-unknown", "exec-002");

    expect(sha).toBe("sha-fallback");
    expect(mock.commit).toHaveBeenCalled();
  });

  it("uses a fallback message containing the promptId when meta is missing", async () => {
    const mock = makeMockGitManager({
      commit: vi.fn().mockResolvedValue("sha-fallback"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    await manager.commit("prompt-xyz", "exec-002");

    const lastCommitCall = (mock.commit as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastCommitCall).toBeDefined();
    const [message] = lastCommitCall as [string, unknown];
    expect(message).toContain("prompt-xyz");
  });

  it("still passes { allowEmpty: true } even without meta", async () => {
    const mock = makeMockGitManager({
      commit: vi.fn().mockResolvedValue("sha-fallback"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    await manager.commit("prompt-unknown", "exec-002");

    const lastCommitCall = (mock.commit as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastCommitCall).toBeDefined();
    const [, opts] = lastCommitCall as [string, { allowEmpty: boolean }];
    expect(opts).toEqual({ allowEmpty: true });
  });
});

// ---------------------------------------------------------------------------
// commit — before initRun throws
// ---------------------------------------------------------------------------

describe("CheckpointManager.commit — before initRun", () => {
  it("throws CheckpointManagerError with code RUN_NOT_INITIALIZED", async () => {
    const mock = makeMockGitManager();
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);

    await expect(manager.commit("prompt-1", "exec-001")).rejects.toThrow(CheckpointManagerError);

    try {
      await manager.commit("prompt-1", "exec-001");
    } catch (err) {
      expect(err).toBeInstanceOf(CheckpointManagerError);
      expect((err as CheckpointManagerError).code).toBe("RUN_NOT_INITIALIZED");
    }
  });
});

// ---------------------------------------------------------------------------
// rollback
// ---------------------------------------------------------------------------

describe("CheckpointManager.rollback", () => {
  it("calls resetHard with the given SHA", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockResolvedValue("sha-base"),
      commit: vi.fn().mockResolvedValue("sha-p1"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    manager.setPromptMeta("prompt-1", BASE_PROMPT_META);
    manager.setExecutionMeta("prompt-1", BASE_EXEC_META);
    await manager.commit("prompt-1", "exec-001");

    await manager.rollback("sha-p1");

    expect(mock.resetHard).toHaveBeenCalledWith("sha-p1");
  });

  it("removes stale checkpoints after the rollback point", async () => {
    const commitShaSequence = ["sha-p1", "sha-p2", "sha-p3"];
    let commitCallCount = 0;
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockResolvedValue("sha-base"),
      commit: vi.fn().mockImplementation(async () => {
        const sha = commitShaSequence[commitCallCount] ?? "sha-unknown";
        commitCallCount++;
        return sha;
      }),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    for (let i = 1; i <= 3; i++) {
      const meta: PromptMetadata = { ...BASE_PROMPT_META, order: i, title: `Prompt ${i}` };
      manager.setPromptMeta(`prompt-${i}`, meta);
      manager.setExecutionMeta(`prompt-${i}`, BASE_EXEC_META);
      await manager.commit(`prompt-${i}`, `exec-00${i}`);
    }

    // We have 3 checkpoints: sha-p1, sha-p2, sha-p3
    expect(await manager.getCheckpoints()).toHaveLength(3);

    // Roll back to sha-p1 (first checkpoint)
    await manager.rollback("sha-p1");

    const remaining = await manager.getCheckpoints();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.sha).toBe("sha-p1");
  });

  it("clears all checkpoints when rolling back to baseSha", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockResolvedValue("sha-base"),
      commit: vi.fn().mockResolvedValue("sha-p1"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    manager.setPromptMeta("prompt-1", BASE_PROMPT_META);
    manager.setExecutionMeta("prompt-1", BASE_EXEC_META);
    await manager.commit("prompt-1", "exec-001");

    await manager.rollback("sha-base");

    const remaining = await manager.getCheckpoints();
    expect(remaining).toHaveLength(0);
  });

  it("throws UNKNOWN_ROLLBACK_TARGET for a SHA not in checkpoint history", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockResolvedValue("sha-base"),
      commit: vi.fn().mockResolvedValue("sha-p1"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    manager.setPromptMeta("prompt-1", BASE_PROMPT_META);
    manager.setExecutionMeta("prompt-1", BASE_EXEC_META);
    await manager.commit("prompt-1", "exec-001");

    await expect(manager.rollback("sha-completely-unknown")).rejects.toThrow(
      CheckpointManagerError,
    );

    try {
      await manager.rollback("sha-completely-unknown");
    } catch (err) {
      expect(err).toBeInstanceOf(CheckpointManagerError);
      expect((err as CheckpointManagerError).code).toBe("UNKNOWN_ROLLBACK_TARGET");
    }
  });
});

// ---------------------------------------------------------------------------
// finishRun — success path
// ---------------------------------------------------------------------------

describe("CheckpointManager.finishRun — success: true", () => {
  it("calls mergeFastForward then deleteBranch by default", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi
        .fn()
        .mockResolvedValueOnce("sha-base") // initRun
        .mockResolvedValueOnce("sha-run-tip") // finishRun: get run tip
        .mockResolvedValueOnce("sha-run-tip"), // finishRun: post-merge validation
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    await manager.finishRun(true, "main");

    expect(mock.mergeFastForward).toHaveBeenCalledWith("conductor/run-testruni", "main");
    expect(mock.deleteBranch).toHaveBeenCalledWith("conductor/run-testruni");
  });

  it("merges but does NOT delete branch when deleteRunBranch: false", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi
        .fn()
        .mockResolvedValueOnce("sha-base")
        .mockResolvedValueOnce("sha-tip")
        .mockResolvedValueOnce("sha-tip"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    await manager.finishRun(true, "main", { deleteRunBranch: false });

    expect(mock.mergeFastForward).toHaveBeenCalled();
    expect(mock.deleteBranch).not.toHaveBeenCalled();
  });

  it("does not merge when mergeToOriginal: false (but still deletes branch by default)", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockResolvedValueOnce("sha-base"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    await manager.finishRun(true, "main", { mergeToOriginal: false });

    // No merge, but deleteRunBranch defaults to true — so the branch is removed.
    expect(mock.mergeFastForward).not.toHaveBeenCalled();
    expect(mock.deleteBranch).toHaveBeenCalledWith("conductor/run-testruni");
  });

  it("does not merge or delete when both mergeToOriginal: false and deleteRunBranch: false", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockResolvedValueOnce("sha-base"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    await manager.finishRun(true, "main", { mergeToOriginal: false, deleteRunBranch: false });

    expect(mock.mergeFastForward).not.toHaveBeenCalled();
    expect(mock.deleteBranch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// finishRun — failure path
// ---------------------------------------------------------------------------

describe("CheckpointManager.finishRun — success: false", () => {
  it("calls checkout(originalBranch) and does NOT merge", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockResolvedValueOnce("sha-base"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    await manager.finishRun(false, "main");

    expect(mock.checkout).toHaveBeenCalledWith("main");
    expect(mock.mergeFastForward).not.toHaveBeenCalled();
    expect(mock.deleteBranch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getCheckpoints
// ---------------------------------------------------------------------------

describe("CheckpointManager.getCheckpoints", () => {
  it("returns an empty array before any commits", async () => {
    const mock = makeMockGitManager();
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    const checkpoints = await manager.getCheckpoints();
    expect(checkpoints).toEqual([]);
  });

  it("returns checkpoints in creation order after multiple commits", async () => {
    const commitShas = ["sha-p1", "sha-p2", "sha-p3"];
    let idx = 0;
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockResolvedValue("sha-base"),
      commit: vi.fn().mockImplementation(async () => commitShas[idx++] ?? "sha-unknown"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    for (let i = 1; i <= 3; i++) {
      const meta: PromptMetadata = { ...BASE_PROMPT_META, order: i, title: `Prompt ${i}` };
      manager.setPromptMeta(`prompt-${i}`, meta);
      manager.setExecutionMeta(`prompt-${i}`, BASE_EXEC_META);
      await manager.commit(`prompt-${i}`, `exec-00${i}`);
    }

    const checkpoints = await manager.getCheckpoints();
    expect(checkpoints).toHaveLength(3);
    expect(checkpoints.map((c) => c.sha)).toEqual(["sha-p1", "sha-p2", "sha-p3"]);
    expect(checkpoints.map((c) => c.promptId)).toEqual(["prompt-1", "prompt-2", "prompt-3"]);
  });

  it("returns a copy so mutations do not affect internal state", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockResolvedValue("sha-base"),
      commit: vi.fn().mockResolvedValue("sha-p1"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    manager.setPromptMeta("prompt-1", BASE_PROMPT_META);
    manager.setExecutionMeta("prompt-1", BASE_EXEC_META);
    await manager.commit("prompt-1", "exec-001");

    const first = await manager.getCheckpoints();
    first.pop(); // mutate the returned copy

    const second = await manager.getCheckpoints();
    expect(second).toHaveLength(1); // internal state unchanged
  });
});

// ---------------------------------------------------------------------------
// initRun — double-init guard
// ---------------------------------------------------------------------------

describe("CheckpointManager.initRun — double-init guard", () => {
  it("throws ALREADY_INITIALIZED when initRun is called twice", async () => {
    const mock = makeMockGitManager();
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);

    await manager.initRun("main");

    await expect(manager.initRun("main")).rejects.toThrow(CheckpointManagerError);

    try {
      await manager.initRun("main");
    } catch (err) {
      expect(err).toBeInstanceOf(CheckpointManagerError);
      expect((err as CheckpointManagerError).code).toBe("ALREADY_INITIALIZED");
    }
  });
});

// ---------------------------------------------------------------------------
// commit / rollback — post-finishRun guards (RUN_FINISHED)
// ---------------------------------------------------------------------------

describe("CheckpointManager — post-finishRun guards", () => {
  async function setupFinishedManager() {
    const mock = makeMockGitManager({
      getHeadSha: vi
        .fn()
        .mockResolvedValueOnce("sha-base") // initRun
        .mockResolvedValueOnce("sha-tip") // finishRun: get run tip
        .mockResolvedValueOnce("sha-tip"), // finishRun: post-merge validation
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");
    await manager.finishRun(true, "main");
    return { mock, manager };
  }

  it("commit() after finishRun(success: true) throws RUN_FINISHED", async () => {
    const { manager } = await setupFinishedManager();

    await expect(manager.commit("prompt-1", "exec-001")).rejects.toThrow(CheckpointManagerError);

    try {
      await manager.commit("prompt-1", "exec-001");
    } catch (err) {
      expect(err).toBeInstanceOf(CheckpointManagerError);
      expect((err as CheckpointManagerError).code).toBe("RUN_FINISHED");
    }
  });

  it("rollback() after finishRun(success: true) throws RUN_FINISHED", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi
        .fn()
        .mockResolvedValueOnce("sha-base") // initRun
        .mockResolvedValueOnce("sha-p1") // finishRun: get run tip
        .mockResolvedValueOnce("sha-p1"), // finishRun: post-merge validation
      commit: vi.fn().mockResolvedValue("sha-p1"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");
    manager.setPromptMeta("prompt-1", BASE_PROMPT_META);
    manager.setExecutionMeta("prompt-1", BASE_EXEC_META);
    await manager.commit("prompt-1", "exec-001");
    await manager.finishRun(true, "main");

    await expect(manager.rollback("sha-p1")).rejects.toThrow(CheckpointManagerError);

    try {
      await manager.rollback("sha-p1");
    } catch (err) {
      expect(err).toBeInstanceOf(CheckpointManagerError);
      expect((err as CheckpointManagerError).code).toBe("RUN_FINISHED");
    }
  });

  it("getDiffForPrompt() after finishRun(success: true) throws RUN_FINISHED", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi
        .fn()
        .mockResolvedValueOnce("sha-base") // initRun
        .mockResolvedValueOnce("sha-p1") // finishRun: get run tip
        .mockResolvedValueOnce("sha-p1"), // finishRun: post-merge validation
      commit: vi.fn().mockResolvedValue("sha-p1"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");
    manager.setPromptMeta("prompt-1", BASE_PROMPT_META);
    manager.setExecutionMeta("prompt-1", BASE_EXEC_META);
    await manager.commit("prompt-1", "exec-001");
    await manager.finishRun(true, "main");

    await expect(manager.getDiffForPrompt("prompt-1")).rejects.toThrow(CheckpointManagerError);

    try {
      await manager.getDiffForPrompt("prompt-1");
    } catch (err) {
      expect(err).toBeInstanceOf(CheckpointManagerError);
      expect((err as CheckpointManagerError).code).toBe("RUN_FINISHED");
    }
  });

  it("finishRun() called twice throws RUN_FINISHED", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi
        .fn()
        .mockResolvedValueOnce("sha-base") // initRun
        .mockResolvedValueOnce("sha-tip") // finishRun: get run tip
        .mockResolvedValueOnce("sha-tip"), // finishRun: post-merge validation
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");
    await manager.finishRun(true, "main");

    await expect(manager.finishRun(true, "main")).rejects.toThrow(CheckpointManagerError);

    try {
      await manager.finishRun(true, "main");
    } catch (err) {
      expect(err).toBeInstanceOf(CheckpointManagerError);
      expect((err as CheckpointManagerError).code).toBe("RUN_FINISHED");
    }
  });
});

// ---------------------------------------------------------------------------
// rollback — state-consistency on resetHard failure
// ---------------------------------------------------------------------------

describe("CheckpointManager.rollback — state consistency on failure", () => {
  it("restores checkpoints to original state when resetHard throws", async () => {
    const commitShas = ["sha-p1", "sha-p2"];
    let idx = 0;
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockResolvedValue("sha-base"),
      commit: vi.fn().mockImplementation(async () => commitShas[idx++] ?? "sha-unknown"),
      resetHard: vi.fn().mockRejectedValue(new Error("git hard reset failed")),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    for (let i = 1; i <= 2; i++) {
      const meta: PromptMetadata = { ...BASE_PROMPT_META, order: i, title: `Prompt ${i}` };
      manager.setPromptMeta(`prompt-${i}`, meta);
      manager.setExecutionMeta(`prompt-${i}`, BASE_EXEC_META);
      await manager.commit(`prompt-${i}`, `exec-00${i}`);
    }

    // Verify initial state: 2 checkpoints
    expect(await manager.getCheckpoints()).toHaveLength(2);

    // Attempt rollback to sha-p1 — resetHard will fail
    await expect(manager.rollback("sha-p1")).rejects.toThrow(CheckpointManagerError);

    try {
      await manager.rollback("sha-p1");
    } catch (err) {
      expect((err as CheckpointManagerError).code).toBe("ROLLBACK_FAILED");
    }

    // State must be restored: still 2 checkpoints
    const remaining = await manager.getCheckpoints();
    expect(remaining).toHaveLength(2);
    expect(remaining.map((c) => c.sha)).toEqual(["sha-p1", "sha-p2"]);
  });

  it("new commit appends correctly after a successful rollback", async () => {
    const commitShas = ["sha-p1", "sha-p2", "sha-p3"];
    let idx = 0;
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockResolvedValue("sha-base"),
      commit: vi.fn().mockImplementation(async () => commitShas[idx++] ?? "sha-unknown"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    for (let i = 1; i <= 2; i++) {
      const meta: PromptMetadata = { ...BASE_PROMPT_META, order: i, title: `Prompt ${i}` };
      manager.setPromptMeta(`prompt-${i}`, meta);
      manager.setExecutionMeta(`prompt-${i}`, BASE_EXEC_META);
      await manager.commit(`prompt-${i}`, `exec-00${i}`);
    }

    // Roll back to first checkpoint
    await manager.rollback("sha-p1");
    expect(await manager.getCheckpoints()).toHaveLength(1);

    // New commit after rollback
    const meta: PromptMetadata = { ...BASE_PROMPT_META, order: 2, title: "Prompt 3 (re-run)" };
    manager.setPromptMeta("prompt-3", meta);
    manager.setExecutionMeta("prompt-3", BASE_EXEC_META);
    await manager.commit("prompt-3", "exec-003");

    const checkpoints = await manager.getCheckpoints();
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints.map((c) => c.sha)).toEqual(["sha-p1", "sha-p3"]);
    expect(checkpoints.map((c) => c.promptId)).toEqual(["prompt-1", "prompt-3"]);
  });
});

// ---------------------------------------------------------------------------
// finishRun — deleteBranch failure is swallowed
// ---------------------------------------------------------------------------

describe("CheckpointManager.finishRun — deleteBranch failure surfaces as BRANCH_DELETE_FAILED", () => {
  it("throws BRANCH_DELETE_FAILED when deleteBranch fails after a successful merge", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi
        .fn()
        .mockResolvedValueOnce("sha-base") // initRun
        .mockResolvedValueOnce("sha-tip") // finishRun: get run tip
        .mockResolvedValueOnce("sha-tip"), // finishRun: post-merge validation
      deleteBranch: vi.fn().mockRejectedValue(new Error("branch deletion failed")),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    await expect(manager.finishRun(true, "main")).rejects.toThrow(CheckpointManagerError);

    // Subsequent calls must still see the run as finished (set in finally).
    await expect(manager.commit("prompt-1", "exec-001")).rejects.toThrow(CheckpointManagerError);
    try {
      await manager.commit("prompt-1", "exec-001");
    } catch (err) {
      expect((err as CheckpointManagerError).code).toBe("RUN_FINISHED");
    }
  });
});

// ---------------------------------------------------------------------------
// finishRun — post-merge getHeadSha failure propagates error
// ---------------------------------------------------------------------------

describe("CheckpointManager.finishRun — post-merge validation failure", () => {
  it("propagates error when getHeadSha throws after mergeFastForward succeeds and still marks run as finished", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi
        .fn()
        .mockResolvedValueOnce("sha-base") // initRun
        .mockResolvedValueOnce("sha-tip") // finishRun: get run tip (before merge)
        .mockRejectedValueOnce(new Error("getHeadSha failed after merge")), // finishRun: post-merge validation
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    await expect(manager.finishRun(true, "main")).rejects.toThrow("getHeadSha failed after merge");

    // mergeFastForward was called (succeeded)
    expect(mock.mergeFastForward).toHaveBeenCalledWith("conductor/run-testruni", "main");
    // deleteBranch must NOT have been called since we never reached that point
    expect(mock.deleteBranch).not.toHaveBeenCalled();

    // The `finally` block must have set finished=true even though the merge
    // validation threw. Verify by attempting another mutation: it must throw
    // RUN_FINISHED rather than e.g. RUN_NOT_INITIALIZED or proceed silently.
    try {
      await manager.commit("prompt-1", "exec-001");
      throw new Error("commit should have thrown RUN_FINISHED");
    } catch (err) {
      expect(err).toBeInstanceOf(CheckpointManagerError);
      expect((err as CheckpointManagerError).code).toBe("RUN_FINISHED");
    }
  });

  it("validateMergeComplete throwing on mismatched SHAs still marks run as finished", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi
        .fn()
        .mockResolvedValueOnce("sha-base") // initRun
        .mockResolvedValueOnce("sha-tip") // finishRun: get run tip
        .mockResolvedValueOnce("sha-different"), // finishRun: post-merge validation (mismatch!)
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    // validateMergeComplete should throw because the post-merge SHA doesn't
    // match the pre-merge run-tip SHA.
    await expect(manager.finishRun(true, "main")).rejects.toThrow();

    // finished must be true via the finally block — verify via guarded method.
    await expect(manager.commit("prompt-x", "exec-x")).rejects.toThrow(CheckpointManagerError);
    try {
      await manager.commit("prompt-x", "exec-x");
    } catch (err) {
      expect((err as CheckpointManagerError).code).toBe("RUN_FINISHED");
    }
  });
});

// ---------------------------------------------------------------------------
// getDiffForPrompt — before initRun
// ---------------------------------------------------------------------------

describe("CheckpointManager.getDiffForPrompt — before initRun", () => {
  it("throws RUN_NOT_INITIALIZED when called before initRun", async () => {
    const mock = makeMockGitManager();
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);

    await expect(manager.getDiffForPrompt("prompt-1")).rejects.toThrow(CheckpointManagerError);

    try {
      await manager.getDiffForPrompt("prompt-1");
    } catch (err) {
      expect(err).toBeInstanceOf(CheckpointManagerError);
      expect((err as CheckpointManagerError).code).toBe("RUN_NOT_INITIALIZED");
    }
  });
});

// ---------------------------------------------------------------------------
// getDiffForPrompt
// ---------------------------------------------------------------------------

describe("CheckpointManager.getDiffForPrompt", () => {
  it("uses baseSha as fromSha for the first prompt", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockResolvedValue("sha-base-000"),
      commit: vi.fn().mockResolvedValue("sha-p1-111"),
      getDiff: vi.fn().mockResolvedValue("diff content"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    manager.setPromptMeta("prompt-1", BASE_PROMPT_META);
    manager.setExecutionMeta("prompt-1", BASE_EXEC_META);
    await manager.commit("prompt-1", "exec-001");

    await manager.getDiffForPrompt("prompt-1");

    expect(mock.getDiff).toHaveBeenCalledWith("sha-base-000", "sha-p1-111");
  });

  it("uses previous checkpoint sha as fromSha for subsequent prompts", async () => {
    const commitShas = ["sha-p1", "sha-p2"];
    let callIdx = 0;
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockResolvedValue("sha-base"),
      commit: vi.fn().mockImplementation(async () => commitShas[callIdx++] ?? "sha-unknown"),
      getDiff: vi.fn().mockResolvedValue("diff content"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    for (let i = 1; i <= 2; i++) {
      const meta: PromptMetadata = { ...BASE_PROMPT_META, order: i, title: `Prompt ${i}` };
      manager.setPromptMeta(`prompt-${i}`, meta);
      manager.setExecutionMeta(`prompt-${i}`, BASE_EXEC_META);
      await manager.commit(`prompt-${i}`, `exec-00${i}`);
    }

    await manager.getDiffForPrompt("prompt-2");

    // Second prompt: fromSha = sha-p1 (first checkpoint), toSha = sha-p2
    expect(mock.getDiff).toHaveBeenCalledWith("sha-p1", "sha-p2");
  });

  it("throws NOT_FOUND for an unknown promptId", async () => {
    const mock = makeMockGitManager();
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    await expect(manager.getDiffForPrompt("non-existent-prompt")).rejects.toThrow(
      CheckpointManagerError,
    );

    try {
      await manager.getDiffForPrompt("non-existent-prompt");
    } catch (err) {
      expect(err).toBeInstanceOf(CheckpointManagerError);
      expect((err as CheckpointManagerError).code).toBe("NOT_FOUND");
    }
  });
});

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
      getHeadSha: vi.fn().mockResolvedValue("sha-after-commit-1"),
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
      getHeadSha: vi.fn().mockResolvedValue("sha-after-commit-1"),
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
      getHeadSha: vi.fn().mockResolvedValue("sha-001"),
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

  it("returns the SHA from getHeadSha()", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi
        .fn()
        .mockResolvedValueOnce("sha-base") // called in initRun
        .mockResolvedValueOnce("sha-prompt-1"), // called in commit
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
      getHeadSha: vi.fn().mockResolvedValueOnce("sha-base").mockResolvedValueOnce("sha-prompt-1"),
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
});

// ---------------------------------------------------------------------------
// commit — without promptMeta (fallback message)
// ---------------------------------------------------------------------------

describe("CheckpointManager.commit — without promptMeta (fallback)", () => {
  it("still commits successfully when no promptMeta is set", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockResolvedValueOnce("sha-base").mockResolvedValueOnce("sha-fallback"),
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
      getHeadSha: vi.fn().mockResolvedValueOnce("sha-base").mockResolvedValueOnce("sha-fallback"),
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
      getHeadSha: vi.fn().mockResolvedValueOnce("sha-base").mockResolvedValueOnce("sha-fallback"),
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
      getHeadSha: vi.fn().mockResolvedValueOnce("sha-base").mockResolvedValueOnce("sha-p1"),
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
    const shaSequence = ["sha-base", "sha-p1", "sha-p2", "sha-p3"];
    let callCount = 0;
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockImplementation(async () => {
        const sha = shaSequence[callCount] ?? "sha-unknown";
        callCount++;
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
      getHeadSha: vi.fn().mockResolvedValueOnce("sha-base").mockResolvedValueOnce("sha-p1"),
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
      getHeadSha: vi.fn().mockResolvedValueOnce("sha-base").mockResolvedValueOnce("sha-p1"),
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

  it("does not merge when mergeToOriginal: false", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockResolvedValueOnce("sha-base"),
    });
    const manager = new CheckpointManager(mock, RUN_ID, WORKING_DIR);
    await manager.initRun("main");

    await manager.finishRun(true, "main", { mergeToOriginal: false });

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
    const shas = ["sha-base", "sha-p1", "sha-p2", "sha-p3"];
    let idx = 0;
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockImplementation(async () => shas[idx++] ?? "sha-unknown"),
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
      getHeadSha: vi.fn().mockResolvedValueOnce("sha-base").mockResolvedValueOnce("sha-p1"),
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
// getDiffForPrompt
// ---------------------------------------------------------------------------

describe("CheckpointManager.getDiffForPrompt", () => {
  it("uses baseSha as fromSha for the first prompt", async () => {
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockResolvedValueOnce("sha-base-000").mockResolvedValueOnce("sha-p1-111"),
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
    const shas = ["sha-base", "sha-p1", "sha-p2"];
    let callIdx = 0;
    const mock = makeMockGitManager({
      getHeadSha: vi.fn().mockImplementation(async () => shas[callIdx++] ?? "sha-unknown"),
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

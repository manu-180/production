/**
 * Unit tests for Conductor checkpoint safety guards.
 *
 * These tests verify that each guard throws the correct SafetyGuardError
 * (with the correct `.code`) when its invariant is violated, and that it
 * does NOT throw when the invariant is satisfied.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SafetyGuardError,
  validateLargeFiles,
  validateMergeComplete,
  validateNoBranchTouch,
  validateNoForcePush,
  validateResetTarget,
  validateWorkingDir,
} from "../safety-guards.js";

// ---------------------------------------------------------------------------
// Guard 1 — validateNoBranchTouch
// ---------------------------------------------------------------------------

describe("validateNoBranchTouch", () => {
  it("does not throw for a branch starting with 'conductor/'", () => {
    expect(() => validateNoBranchTouch("conductor/run-abc123")).not.toThrow();
  });

  it("does not throw for nested conductor/ branches", () => {
    expect(() => validateNoBranchTouch("conductor/2024-01-01/task-1")).not.toThrow();
  });

  it("throws PROTECTED_BRANCH for 'main'", () => {
    expect(() => validateNoBranchTouch("main")).toThrow(SafetyGuardError);
    try {
      validateNoBranchTouch("main");
    } catch (err) {
      expect(err).toBeInstanceOf(SafetyGuardError);
      expect((err as SafetyGuardError).code).toBe("PROTECTED_BRANCH");
    }
  });

  it("throws PROTECTED_BRANCH for 'feature/my-feature'", () => {
    expect(() => validateNoBranchTouch("feature/my-feature")).toThrow(SafetyGuardError);
    try {
      validateNoBranchTouch("feature/my-feature");
    } catch (err) {
      expect((err as SafetyGuardError).code).toBe("PROTECTED_BRANCH");
    }
  });

  it("throws PROTECTED_BRANCH for empty string", () => {
    expect(() => validateNoBranchTouch("")).toThrow(SafetyGuardError);
    try {
      validateNoBranchTouch("");
    } catch (err) {
      expect((err as SafetyGuardError).code).toBe("PROTECTED_BRANCH");
    }
  });

  it("throws PROTECTED_BRANCH for 'develop'", () => {
    expect(() => validateNoBranchTouch("develop")).toThrow(SafetyGuardError);
    try {
      validateNoBranchTouch("develop");
    } catch (err) {
      expect((err as SafetyGuardError).code).toBe("PROTECTED_BRANCH");
    }
  });

  it("throws PROTECTED_BRANCH even if branch contains 'conductor' but doesn't start with 'conductor/'", () => {
    expect(() => validateNoBranchTouch("my-conductor/branch")).toThrow(SafetyGuardError);
    try {
      validateNoBranchTouch("my-conductor/branch");
    } catch (err) {
      expect((err as SafetyGuardError).code).toBe("PROTECTED_BRANCH");
    }
  });
});

// ---------------------------------------------------------------------------
// Guard 2 — validateResetTarget
// ---------------------------------------------------------------------------

describe("validateResetTarget", () => {
  const history = [
    "aabbcc1111111111111111111111111111111111",
    "ddeeff2222222222222222222222222222222222",
    "112233aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ];

  it("does not throw when targetSha is in branchHistory", () => {
    expect(() =>
      validateResetTarget("aabbcc1111111111111111111111111111111111", history),
    ).not.toThrow();
  });

  it("does not throw for any SHA in the history list", () => {
    for (const sha of history) {
      expect(() => validateResetTarget(sha, history)).not.toThrow();
    }
  });

  it("throws UNSAFE_RESET_TARGET when SHA is not in history", () => {
    expect(() => validateResetTarget("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", history)).toThrow(
      SafetyGuardError,
    );
    try {
      validateResetTarget("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", history);
    } catch (err) {
      expect(err).toBeInstanceOf(SafetyGuardError);
      expect((err as SafetyGuardError).code).toBe("UNSAFE_RESET_TARGET");
    }
  });

  it("throws UNSAFE_RESET_TARGET when history is empty", () => {
    expect(() => validateResetTarget("aabbcc1111111111111111111111111111111111", [])).toThrow(
      SafetyGuardError,
    );
    try {
      validateResetTarget("aabbcc1111111111111111111111111111111111", []);
    } catch (err) {
      expect((err as SafetyGuardError).code).toBe("UNSAFE_RESET_TARGET");
    }
  });
});

// ---------------------------------------------------------------------------
// Guard 3 — validateWorkingDir
// ---------------------------------------------------------------------------

describe("validateWorkingDir", () => {
  it("does not throw when directories match", () => {
    expect(() => validateWorkingDir("/home/user/project", "/home/user/project")).not.toThrow();
  });

  it("throws WRONG_WORKING_DIR when directories differ", () => {
    expect(() => validateWorkingDir("/home/user/project", "/home/user/other")).toThrow(
      SafetyGuardError,
    );
    try {
      validateWorkingDir("/home/user/project", "/home/user/other");
    } catch (err) {
      expect(err).toBeInstanceOf(SafetyGuardError);
      expect((err as SafetyGuardError).code).toBe("WRONG_WORKING_DIR");
    }
  });

  it("throws WRONG_WORKING_DIR for case-sensitive differences", () => {
    // On Linux/Mac paths are case-sensitive; this guard uses strict ===
    expect(() => validateWorkingDir("/Home/User/Project", "/home/user/project")).toThrow(
      SafetyGuardError,
    );
    try {
      validateWorkingDir("/Home/User/Project", "/home/user/project");
    } catch (err) {
      expect((err as SafetyGuardError).code).toBe("WRONG_WORKING_DIR");
    }
  });

  it("throws WRONG_WORKING_DIR when workingDir has trailing slash but runWorkingDir does not", () => {
    expect(() => validateWorkingDir("/home/user/project/", "/home/user/project")).toThrow(
      SafetyGuardError,
    );
  });
});

// ---------------------------------------------------------------------------
// Guard 4 — validateNoForcePush
// ---------------------------------------------------------------------------

describe("validateNoForcePush", () => {
  it("always throws NO_FORCE_PUSH", () => {
    expect(() => validateNoForcePush()).toThrow(SafetyGuardError);
  });

  it("throws with code NO_FORCE_PUSH", () => {
    try {
      validateNoForcePush();
    } catch (err) {
      expect(err).toBeInstanceOf(SafetyGuardError);
      expect((err as SafetyGuardError).code).toBe("NO_FORCE_PUSH");
    }
  });

  it("throws every time it is called, no exceptions", () => {
    for (let i = 0; i < 5; i++) {
      expect(() => validateNoForcePush()).toThrow(SafetyGuardError);
    }
  });
});

// ---------------------------------------------------------------------------
// Guard 5 — validateMergeComplete
// ---------------------------------------------------------------------------

describe("validateMergeComplete", () => {
  const sha = "abcdef1234567890abcdef1234567890abcdef12";

  it("does not throw when expectedSha equals actualHeadSha", () => {
    expect(() => validateMergeComplete(sha, sha)).not.toThrow();
  });

  it("throws MERGE_NOT_COMPLETE when SHAs differ", () => {
    expect(() => validateMergeComplete(sha, "0000000000000000000000000000000000000000")).toThrow(
      SafetyGuardError,
    );
    try {
      validateMergeComplete(sha, "0000000000000000000000000000000000000000");
    } catch (err) {
      expect(err).toBeInstanceOf(SafetyGuardError);
      expect((err as SafetyGuardError).code).toBe("MERGE_NOT_COMPLETE");
    }
  });

  it("throws MERGE_NOT_COMPLETE when actualHeadSha is empty string", () => {
    expect(() => validateMergeComplete(sha, "")).toThrow(SafetyGuardError);
    try {
      validateMergeComplete(sha, "");
    } catch (err) {
      expect((err as SafetyGuardError).code).toBe("MERGE_NOT_COMPLETE");
    }
  });
});

// ---------------------------------------------------------------------------
// Guard 6 — validateLargeFiles
// ---------------------------------------------------------------------------

describe("validateLargeFiles", () => {
  let tmpDir: string;
  let smallFile: string;
  let largeFile: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "conductor-test-"));

    // Small file: 1 KB
    smallFile = join(tmpDir, "small.txt");
    await writeFile(smallFile, "x".repeat(1024));

    // Large file: 150 MB worth of data — we fake the size by writing bytes.
    // Writing 150 MB in a test is too slow; instead write 5 MB and set
    // the limit to 1 MB so the guard fires.
    largeFile = join(tmpDir, "large.bin");
    await writeFile(largeFile, Buffer.alloc(5 * 1024 * 1024, 0x61)); // 5 MB
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("does not throw when all files are below the size limit", async () => {
    await expect(validateLargeFiles([smallFile], 100)).resolves.toBeUndefined();
  });

  it("does not throw for an empty file list", async () => {
    await expect(validateLargeFiles([], 100)).resolves.toBeUndefined();
  });

  it("throws LARGE_FILES_DETECTED when a file exceeds the limit", async () => {
    await expect(validateLargeFiles([largeFile], 1)).rejects.toThrow(SafetyGuardError);
    try {
      await validateLargeFiles([largeFile], 1);
    } catch (err) {
      expect(err).toBeInstanceOf(SafetyGuardError);
      expect((err as SafetyGuardError).code).toBe("LARGE_FILES_DETECTED");
      expect((err as SafetyGuardError).message).toContain("large.bin");
    }
  });

  it("uses 100 MB default limit and does not throw for small files", async () => {
    await expect(validateLargeFiles([smallFile])).resolves.toBeUndefined();
  });

  it("throws when only one file in a mixed list is too large", async () => {
    await expect(validateLargeFiles([smallFile, largeFile], 1)).rejects.toThrow(SafetyGuardError);
    try {
      await validateLargeFiles([smallFile, largeFile], 1);
    } catch (err) {
      expect((err as SafetyGuardError).code).toBe("LARGE_FILES_DETECTED");
      // smallFile is NOT mentioned in the error
      expect((err as SafetyGuardError).message).toContain("large.bin");
      expect((err as SafetyGuardError).message).not.toContain("small.txt");
    }
  });

  it("silently skips non-existent files (deletions are safe)", async () => {
    await expect(
      validateLargeFiles([join(tmpDir, "does-not-exist.txt")], 100),
    ).resolves.toBeUndefined();
  });

  it("SafetyGuardError has correct name property", () => {
    const err = new SafetyGuardError("TEST_CODE", "test message");
    expect(err.name).toBe("SafetyGuardError");
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("test message");
    expect(err).toBeInstanceOf(Error);
  });
});

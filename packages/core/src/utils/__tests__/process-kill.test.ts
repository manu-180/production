import type { ExecFileException } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:child_process before importing the module under test
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Mock logger
vi.mock("../../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { execFile } from "node:child_process";
import { logger } from "../../logger.js";
import { isPidAliveWindows, killProcessTreeWindowsVerified } from "../process-kill.js";

const mockedExecFile = vi.mocked(execFile);
const mockedLogger = vi.mocked(logger);

// Helper: make execFile call its callback with success (stdout).
// NOTE: when promisify wraps a function lacking the [promisify.custom] symbol
// (our vi.fn does), it resolves with the SECOND arg only. We pass an
// {stdout, stderr} object so destructuring `const { stdout } = await ...` works.
function mockExecFileSuccess(stdout: string) {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    (
      callback as (err: ExecFileException | null, value: { stdout: string; stderr: string }) => void
    )(null, { stdout, stderr: "" });
    return {} as ReturnType<typeof execFile>;
  });
}

// Helper: make execFile call its callback with an error
function mockExecFileError(message: string) {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    const err = new Error(message) as ExecFileException;
    (
      callback as (err: ExecFileException | null, value: { stdout: string; stderr: string }) => void
    )(err, { stdout: "", stderr: "" });
    return {} as ReturnType<typeof execFile>;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isPidAliveWindows", () => {
  it("returns false for pid <= 0 without calling tasklist", async () => {
    const result = await isPidAliveWindows(0);
    expect(result).toBe(false);
    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  it("returns false for negative pid without calling tasklist", async () => {
    const result = await isPidAliveWindows(-1);
    expect(result).toBe(false);
    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  it("parses CSV from tasklist and returns true when process is found", async () => {
    mockExecFileSuccess('"claude.exe","1234","Console","1","100,000 K"\r\n');
    const result = await isPidAliveWindows(1234);
    expect(result).toBe(true);
  });

  it('returns false when tasklist says "INFO: No tasks running"', async () => {
    mockExecFileSuccess("INFO: No tasks are running which match the specified criteria.\r\n");
    const result = await isPidAliveWindows(1234);
    expect(result).toBe(false);
  });

  it("returns null and logs warn when execFile throws", async () => {
    mockExecFileError("timeout");
    const result = await isPidAliveWindows(1234);
    expect(result).toBeNull();
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 1234 }),
      "process-kill.is_pid_alive_failed",
    );
  });
});

describe("killProcessTreeWindowsVerified", () => {
  it("returns already_dead for pid <= 0", async () => {
    const result = await killProcessTreeWindowsVerified(0);
    expect(result).toBe("already_dead");
    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  // Helper: queue a one-shot success or error response on the execFile mock.
  // Pass the value as { stdout, stderr } so it round-trips through promisify
  // (which resolves with the second callback arg) into `const { stdout } = ...`.
  function queueSuccess(stdout: string) {
    mockedExecFile.mockImplementationOnce((_cmd, _args, _opts, callback) => {
      (
        callback as (
          err: ExecFileException | null,
          value: { stdout: string; stderr: string },
        ) => void
      )(null, { stdout, stderr: "" });
      return {} as ReturnType<typeof execFile>;
    });
  }
  function queueError(message: string) {
    mockedExecFile.mockImplementationOnce((_cmd, _args, _opts, callback) => {
      const err = new Error(message) as ExecFileException;
      (
        callback as (
          err: ExecFileException | null,
          value: { stdout: string; stderr: string },
        ) => void
      )(err, { stdout: "", stderr: "" });
      return {} as ReturnType<typeof execFile>;
    });
  }

  it("returns already_dead when taskkill fails but pid is already gone", async () => {
    // taskkill fails, then tasklist says not found
    queueError("access denied");
    queueSuccess("INFO: No tasks are running which match the specified criteria.\r\n");

    const result = await killProcessTreeWindowsVerified(1234);
    expect(result).toBe("already_dead");
    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 1234 }),
      "process-kill.verified_dead",
    );
  });

  it("uses PowerShell fallback when taskkill succeeds but pid still alive, then confirms dead", async () => {
    queueSuccess(""); // taskkill success
    queueSuccess('"node.exe","1234","Console","1","50,000 K"\r\n'); // first verify: alive
    queueSuccess(""); // Stop-Process success
    queueSuccess("INFO: No tasks are running which match the specified criteria.\r\n"); // second verify: dead

    const result = await killProcessTreeWindowsVerified(1234);
    expect(result).toBe("killed");
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 1234 }),
      "process-kill.fallback_powershell",
    );
  });

  it("returns still_alive and logs error when all attempts fail", async () => {
    queueSuccess(""); // taskkill success
    queueSuccess('"node.exe","1234","Console","1","50,000 K"\r\n'); // first verify: alive
    queueSuccess(""); // Stop-Process success
    queueSuccess('"node.exe","1234","Console","1","50,000 K"\r\n'); // second verify: STILL alive

    const result = await killProcessTreeWindowsVerified(1234);
    expect(result).toBe("still_alive");
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 1234 }),
      "process-kill.still_alive_after_all_attempts",
    );
  });
});

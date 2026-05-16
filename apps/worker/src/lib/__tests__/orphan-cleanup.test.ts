import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

import { logger } from "@conductor/core";
import {
  cleanupOrphanClaudeProcesses,
  killProcessTree,
  listClaudeProcesses,
} from "../orphan-cleanup.js";

describe("orphan-cleanup", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    vi.restoreAllMocks();
  });

  describe("listClaudeProcesses", () => {
    it("returns [] when execFile throws", async () => {
      execFileMock.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, callback: (err: Error) => void) => {
          callback(new Error("spawn ENOENT"));
        },
      );

      const result = await listClaudeProcesses();
      expect(result).toEqual([]);
    });
  });

  describe("killProcessTree", () => {
    it("returns false for invalid pids", async () => {
      expect(await killProcessTree(0)).toBe(false);
      expect(await killProcessTree(-1)).toBe(false);
      expect(await killProcessTree(Number.NaN)).toBe(false);
    });
  });

  describe("cleanupOrphanClaudeProcesses", () => {
    it("kills processes whose parent is no longer alive (true orphans)", async () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const infoSpy = vi.spyOn(logger, "info");

      // Pick parent pids that will return ESRCH on `process.kill(pid, 0)` so
      // the orphan filter classifies them as orphaned. PID 0 / very large
      // PIDs reliably yield "no such process" on Windows and POSIX without
      // requiring special permissions.
      const deadParent = 2_147_483_640;

      execFileMock.mockImplementation(
        (
          cmd: string,
          _args: string[],
          _opts: unknown,
          callback: (err: null, result: { stdout: string; stderr: string }) => void,
        ) => {
          if (cmd === "powershell.exe") {
            callback(null, {
              stdout: JSON.stringify([
                { ProcessId: 1234, ParentProcessId: deadParent, CommandLine: "claude.exe" },
                { ProcessId: 5678, ParentProcessId: deadParent, CommandLine: "claude.exe" },
              ]),
              stderr: "",
            });
          } else {
            // taskkill success
            callback(null, { stdout: "", stderr: "" });
          }
        },
      );

      const result = await cleanupOrphanClaudeProcesses();

      expect(result).toEqual({ found: 2, killed: 2 });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ orphans: 2, total: 2 }),
        "orphan-cleanup.found_orphans",
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ pid: 1234 }),
        "orphan-cleanup.kill_attempt",
      );
    });

    it("skips processes whose parent is still alive (not orphans)", async () => {
      const infoSpy = vi.spyOn(logger, "info");

      // Use the current Node process pid as parent — guaranteed alive.
      const liveParent = process.pid;

      execFileMock.mockImplementation(
        (
          cmd: string,
          _args: string[],
          _opts: unknown,
          callback: (err: null, result: { stdout: string; stderr: string }) => void,
        ) => {
          if (cmd === "powershell.exe") {
            callback(null, {
              stdout: JSON.stringify([
                { ProcessId: 1234, ParentProcessId: liveParent, CommandLine: "claude.exe" },
              ]),
              stderr: "",
            });
          } else {
            callback(null, { stdout: "", stderr: "" });
          }
        },
      );

      const result = await cleanupOrphanClaudeProcesses();

      expect(result).toEqual({ found: 1, killed: 0 });
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ totalSeen: 1, skipped: 1 }),
        expect.stringContaining("none_truly_orphaned"),
      );
    });

    it("logs none_found and returns {found:0, killed:0} when no processes", async () => {
      const infoSpy = vi.spyOn(logger, "info");

      execFileMock.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          callback: (err: null, result: { stdout: string; stderr: string }) => void,
        ) => {
          // powershell returns empty — no claude processes
          callback(null, { stdout: "", stderr: "" });
        },
      );

      const result = await cleanupOrphanClaudeProcesses();

      expect(result).toEqual({ found: 0, killed: 0 });
      expect(infoSpy).toHaveBeenCalledWith({}, "orphan-cleanup.none_found");
    });
  });
});

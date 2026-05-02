import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

import { validateCliAuth } from "../token-validator.js";

describe("validateCliAuth", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("returns true when CLI ping exits 0", async () => {
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: readonly string[],
        _opts: unknown,
        callback: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, "pong", "");
      },
    );

    await expect(validateCliAuth()).resolves.toBe(true);
  });

  it("returns false when CLI exits non-zero", async () => {
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: readonly string[],
        _opts: unknown,
        callback: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(new Error("CLI exited with code 1"), "", "auth error");
      },
    );

    await expect(validateCliAuth()).resolves.toBe(false);
  });

  it("returns false when CLI throws synchronously", async () => {
    execFileMock.mockImplementation(() => {
      throw new Error("spawn ENOENT");
    });

    await expect(validateCliAuth()).resolves.toBe(false);
  });

  it("never throws — always resolves to a boolean", async () => {
    execFileMock.mockImplementation(() => {
      throw new Error("unexpected explosion");
    });

    const result = await validateCliAuth();
    expect(typeof result).toBe("boolean");
    expect(result).toBe(false);
  });
});

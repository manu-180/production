import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock("../../../logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../utils/process-kill.js", () => ({
  killProcessTreeWindowsVerified: vi.fn().mockResolvedValue("killed"),
}));

vi.mock("../command-builder.js", () => ({
  buildClaudeArgs: vi.fn().mockReturnValue(["-p", "test"]),
  resolveClaudeBinary: vi.fn().mockReturnValue({ command: "claude", useShell: false }),
}));

import { spawn } from "node:child_process";
import { ClaudeProcess } from "../claude-process.js";
import { ExecutorErrorCode } from "../errors.js";

const mockedSpawn = vi.mocked(spawn);

function makeChildMock() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  const exitCbs: Array<(code: number, signal: null) => void> = [];
  const errorCbs: Array<(err: Error) => void> = [];

  function registerOn(event: string, cb: (...args: unknown[]) => void) {
    if (event === "exit") exitCbs.push(cb as (code: number, signal: null) => void);
    if (event === "error") errorCbs.push(cb as (err: Error) => void);
    return child;
  }

  const child = {
    stdin,
    stdout,
    stderr,
    pid: 9999,
    on: vi.fn(registerOn),
    once: vi.fn(registerOn),
    unref: vi.fn(),
    triggerExit(code: number) {
      for (const cb of [...exitCbs]) cb(code, null);
    },
  };
  return child;
}

function makeProcess(idleTimeoutMs: number) {
  return new ClaudeProcess(
    {
      prompt: "test",
      workingDir: "C:\\tmp",
      permissionMode: "default",
      idleTimeoutMs,
    },
    { ANTHROPIC_API_KEY: "test" },
  );
}

describe("ClaudeProcess — idle timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("wait() rejects with IDLE_STALL when process produces no output", async () => {
    const child = makeChildMock();
    mockedSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const proc = makeProcess(200);
    await proc.start();

    // Advance time past the idle threshold — no stdout/stderr emitted
    vi.advanceTimersByTime(300);

    // Simulate the process dying after the idle kill fires
    child.triggerExit(1);
    child.stdout.destroy();
    child.stderr.destroy();

    await expect(proc.wait()).rejects.toMatchObject({
      code: ExecutorErrorCode.IDLE_STALL,
    });
  });

  it("process emitting stdout every 100ms does NOT trigger idle of 200ms", async () => {
    const child = makeChildMock();
    mockedSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const proc = makeProcess(200);
    await proc.start();

    // Emit stdout every 100ms for 500ms total
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(100);
      child.stdout.push('{"type":"text","text":"."}\n');
    }

    // Finish normally
    child.triggerExit(0);
    child.stdout.destroy();
    child.stderr.destroy();

    const result = await proc.wait();
    expect(result.finalStatus).not.toBe("timeout");
  });

  it("stderr activity resets idle timer so process is not killed", async () => {
    const child = makeChildMock();
    mockedSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const proc = makeProcess(300);
    await proc.start();

    // Emit stderr every 100ms for 500ms — no stdout at all
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(100);
      child.stderr.push("some stderr output\n");
    }

    // Finish normally
    child.triggerExit(0);
    child.stdout.destroy();
    child.stderr.destroy();

    const result = await proc.wait();
    expect(result.finalStatus).not.toBe("timeout");
  });
});

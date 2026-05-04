import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("../../../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../utils/process-kill.js", () => ({
  killProcessTreeWindowsVerified: vi.fn().mockResolvedValue("killed"),
}));

import { execFile } from "node:child_process";
import { TimeoutManager, hardKillAsync, softKillAsync } from "../timeout-manager.js";

const mockedExecFile = vi.mocked(execFile);

function mockExecFileSuccess() {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    (callback as (err: null, stdout: string, stderr: string) => void)(null, "", "");
    return {} as ReturnType<typeof execFile>;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("softKillAsync (Windows path)", () => {
  it("awaits execFile with timeout instead of fire-and-forget", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    mockExecFileSuccess();
    await softKillAsync(1234);

    expect(mockedExecFile).toHaveBeenCalledWith(
      "taskkill",
      ["/T", "/PID", "1234"],
      expect.objectContaining({ timeout: 5_000 }),
      expect.any(Function),
    );

    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("does nothing for null pid", async () => {
    await softKillAsync(null);
    expect(mockedExecFile).not.toHaveBeenCalled();
  });
});

describe("hardKillAsync (Windows path)", () => {
  it("calls killProcessTreeWindowsVerified on Windows", async () => {
    const { killProcessTreeWindowsVerified } = await import("../../utils/process-kill.js");
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    await hardKillAsync(1234);

    expect(killProcessTreeWindowsVerified).toHaveBeenCalledWith(1234);

    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });
});

describe("TimeoutManager", () => {
  it("softThenHard schedules hard kill after grace period", () => {
    const onSoftKill = vi.fn();
    const onHardKill = vi.fn();
    const manager = new TimeoutManager({ graceMs: 1000, onSoftKill, onHardKill });

    manager.softThenHard(null); // null pid — no actual process kill

    expect(onSoftKill).toHaveBeenCalledOnce();
    expect(onHardKill).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onHardKill).toHaveBeenCalledOnce();
  });

  it("clear cancels both timeout and grace handle", () => {
    const manager = new TimeoutManager({ timeoutMs: 5000, graceMs: 1000 });
    manager.start(null);
    manager.clear();

    vi.advanceTimersByTime(10000);
    expect(manager.didTimeout).toBe(false);
  });
});

describe("TimeoutManager — idle timeout", () => {
  it("fires onIdleTimeout after idleTimeoutMs with no activity", () => {
    const onIdleTimeout = vi.fn();
    const tm = new TimeoutManager({ idleTimeoutMs: 1000, onIdleTimeout });
    tm.start(123);
    vi.advanceTimersByTime(1100);
    expect(onIdleTimeout).toHaveBeenCalledOnce();
    expect(tm.didIdleTimeout).toBe(true);
  });

  it("notifyActivity resets the idle timer", () => {
    const onIdleTimeout = vi.fn();
    const tm = new TimeoutManager({ idleTimeoutMs: 1000, onIdleTimeout });
    tm.start(123);
    vi.advanceTimersByTime(500);
    tm.notifyActivity(123);
    vi.advanceTimersByTime(800);
    // 800ms since last activity < 1000ms threshold
    expect(onIdleTimeout).not.toHaveBeenCalled();
    expect(tm.didIdleTimeout).toBe(false);
  });

  it("idle fires without triggering wall-clock global timeout", () => {
    const onTimeout = vi.fn();
    const onIdleTimeout = vi.fn();
    const tm = new TimeoutManager({
      timeoutMs: 10_000,
      idleTimeoutMs: 1000,
      onTimeout,
      onIdleTimeout,
    });
    tm.start(123);
    vi.advanceTimersByTime(1100);
    expect(onIdleTimeout).toHaveBeenCalledOnce();
    expect(tm.didIdleTimeout).toBe(true);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(tm.didTimeout).toBe(false);
  });

  it("idleTimeoutMs=0 disables idle timeout", () => {
    const onIdleTimeout = vi.fn();
    const tm = new TimeoutManager({ idleTimeoutMs: 0, onIdleTimeout });
    tm.start(123);
    vi.advanceTimersByTime(60_000);
    expect(onIdleTimeout).not.toHaveBeenCalled();
    expect(tm.didIdleTimeout).toBe(false);
    // notifyActivity on a disabled manager is a no-op
    tm.notifyActivity(123);
    vi.advanceTimersByTime(5000);
    expect(onIdleTimeout).not.toHaveBeenCalled();
  });

  it("clear() cancels the idle handle so it never fires", () => {
    const onIdleTimeout = vi.fn();
    const tm = new TimeoutManager({ idleTimeoutMs: 1000, onIdleTimeout });
    tm.start(123);
    tm.clear();
    vi.advanceTimersByTime(5000);
    expect(onIdleTimeout).not.toHaveBeenCalled();
  });
});

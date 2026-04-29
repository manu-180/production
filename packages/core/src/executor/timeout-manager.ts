import { spawn } from "node:child_process";

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_GRACE_MS = 30 * 1000;

export interface TimeoutManagerOptions {
  timeoutMs?: number;
  graceMs?: number;
  onSoftKill?: () => void;
  onHardKill?: () => void;
  onTimeout?: () => void;
}

export class TimeoutManager {
  private readonly timeoutMs: number;
  private readonly graceMs: number;
  private readonly onSoftKill?: () => void;
  private readonly onHardKill?: () => void;
  private readonly onTimeout?: () => void;

  private timeoutHandle: NodeJS.Timeout | null = null;
  private graceHandle: NodeJS.Timeout | null = null;
  private timedOut = false;

  constructor(opts: TimeoutManagerOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
    if (opts.onSoftKill) this.onSoftKill = opts.onSoftKill;
    if (opts.onHardKill) this.onHardKill = opts.onHardKill;
    if (opts.onTimeout) this.onTimeout = opts.onTimeout;
  }

  start(pid: number | null): void {
    this.clear();
    this.timeoutHandle = setTimeout(() => {
      this.timedOut = true;
      this.onTimeout?.();
      this.softThenHard(pid);
    }, this.timeoutMs);
  }

  softThenHard(pid: number | null): void {
    this.onSoftKill?.();
    softKill(pid);
    this.graceHandle = setTimeout(() => {
      this.onHardKill?.();
      hardKill(pid);
    }, this.graceMs);
  }

  clear(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    if (this.graceHandle) {
      clearTimeout(this.graceHandle);
      this.graceHandle = null;
    }
  }

  get didTimeout(): boolean {
    return this.timedOut;
  }
}

export function softKill(pid: number | null): void {
  if (pid === null || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      const child = spawn("taskkill", ["/T", "/PID", String(pid)], {
        windowsHide: true,
        stdio: "ignore",
      });
      child.on("error", () => {});
      child.unref();
    } catch {
      // ignore
    }
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // process may already be dead
  }
}

export function hardKill(pid: number | null): void {
  if (pid === null || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      const child = spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
        windowsHide: true,
        stdio: "ignore",
      });
      child.on("error", () => {});
      child.unref();
    } catch {
      // ignore
    }
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // process may already be dead
  }
}

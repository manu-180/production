import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../logger.js";
import { killProcessTreeWindowsVerified } from "../utils/process-kill.js";

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_GRACE_MS = 30 * 1000;
export const DEFAULT_IDLE_TIMEOUT_MS = 90 * 1000;

export interface TimeoutManagerOptions {
  timeoutMs?: number;
  graceMs?: number;
  idleTimeoutMs?: number;
  onSoftKill?: () => void;
  onHardKill?: () => void;
  onTimeout?: () => void;
  onIdleTimeout?: () => void;
}

export class TimeoutManager {
  private readonly timeoutMs: number;
  private readonly graceMs: number;
  private readonly idleTimeoutMs: number;
  private readonly onSoftKill?: () => void;
  private readonly onHardKill?: () => void;
  private readonly onTimeout?: () => void;
  private readonly onIdleTimeout?: () => void;

  private timeoutHandle: NodeJS.Timeout | null = null;
  private graceHandle: NodeJS.Timeout | null = null;
  private idleHandle: NodeJS.Timeout | null = null;
  private timedOut = false;
  private idledOut = false;

  constructor(opts: TimeoutManagerOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 0;
    if (opts.onSoftKill) this.onSoftKill = opts.onSoftKill;
    if (opts.onHardKill) this.onHardKill = opts.onHardKill;
    if (opts.onTimeout) this.onTimeout = opts.onTimeout;
    if (opts.onIdleTimeout) this.onIdleTimeout = opts.onIdleTimeout;
  }

  start(pid: number | null): void {
    this.clear();
    this.timeoutHandle = setTimeout(() => {
      this.timedOut = true;
      this.onTimeout?.();
      this.softThenHard(pid);
    }, this.timeoutMs);
    if (this.idleTimeoutMs > 0) {
      this.idleHandle = setTimeout(() => {
        this.idledOut = true;
        this.onIdleTimeout?.();
        this.softThenHard(pid);
      }, this.idleTimeoutMs);
    }
  }

  notifyActivity(pid: number | null): void {
    if (this.idleTimeoutMs <= 0) return;
    if (this.idledOut || this.timedOut) return;
    if (this.idleHandle) clearTimeout(this.idleHandle);
    this.idleHandle = setTimeout(() => {
      this.idledOut = true;
      this.onIdleTimeout?.();
      this.softThenHard(pid);
    }, this.idleTimeoutMs);
  }

  softThenHard(pid: number | null): void {
    this.onSoftKill?.();
    void softKillAsync(pid);
    this.graceHandle = setTimeout(() => {
      this.onHardKill?.();
      void hardKillAsync(pid);
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
    if (this.idleHandle) {
      clearTimeout(this.idleHandle);
      this.idleHandle = null;
    }
  }

  get didTimeout(): boolean {
    return this.timedOut;
  }

  get didIdleTimeout(): boolean {
    return this.idledOut;
  }
}

const execFileAsync = promisify(execFile);

export async function softKillAsync(pid: number | null): Promise<void> {
  if (pid === null || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/T", "/PID", String(pid)], {
        windowsHide: true,
        timeout: 5_000,
      });
      logger.info({ pid }, "timeout-manager.soft_kill.sent");
    } catch (err) {
      logger.warn({ err, pid }, "timeout-manager.soft_kill.failed");
    }
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already dead
  }
}

export async function hardKillAsync(pid: number | null): Promise<void> {
  if (pid === null || pid <= 0) return;
  if (process.platform === "win32") {
    const result = await killProcessTreeWindowsVerified(pid);
    logger.info({ pid, result }, "timeout-manager.hard_kill.done");
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already dead
  }
}

// BC: keep sync versions as fire-and-forget wrappers for setTimeout callbacks
export function softKill(pid: number | null): void {
  void softKillAsync(pid);
}
export function hardKill(pid: number | null): void {
  void hardKillAsync(pid);
}

import { type ChildProcessByStdio, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { type Interface, createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { createLogger } from "../logger.js";
import {
  type ClaudeCommandOptions,
  buildClaudeArgs,
  resolveClaudeBinary,
} from "./command-builder.js";
import { aggregateUsage, calcCost } from "./cost-calculator.js";
import { ExecutorError, ExecutorErrorCode } from "./errors.js";
import {
  type ClaudeStreamEvent,
  type TokenUsage,
  isAssistantEvent,
  isResultEvent,
} from "./event-types.js";
import { StreamParser } from "./stream-parser.js";
import { DEFAULT_IDLE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, TimeoutManager } from "./timeout-manager.js";

type ClaudeChild = ChildProcessByStdio<Writable, Readable, Readable>;

const log = createLogger("executor:claude-process");

const MAX_QUEUE_SIZE = 10_000;
const RATE_LIMIT_PATTERN = /rate[\s_-]?limit/i;
const AUTH_PATTERN = /(unauthor|invalid[\s_-]?token|authentication)/i;

/**
 * Maximum time we wait for stdout/stderr `close` events after the process
 * has already exited. On Windows, when Claude CLI spawns MCP server
 * subprocesses, those children inherit the parent's stdio handles; even
 * after `cmd.exe` / `claude.cmd` exits, the OS keeps the pipe write end
 * open until the MCP processes also exit. That blocks our `closePromise`
 * indefinitely and the orchestrator hangs on the first prompt waiting for
 * `wait()` to resolve.
 *
 * Once `exit` has fired, the process is gone — any remaining stream data
 * is from MCP children we don't control. We force-destroy the read end of
 * the pipes after this grace period so the readline interfaces close and
 * `wait()` proceeds. The stream buffer up to that point is still captured.
 */
const POST_EXIT_STREAM_GRACE_MS = 3_000;

export type FinalStatus = "success" | "error" | "killed" | "timeout";

export interface ExecutionResult {
  exitCode: number;
  sessionId: string;
  durationMs: number;
  finalStatus: FinalStatus;
  usage: TokenUsage;
  costUsd: number;
  errorMessage?: string;
  stderrRaw?: string;
  stdoutRaw?: string;
  capturedEvents: ClaudeStreamEvent[];
}

export interface ClaudeProcessOptions extends ClaudeCommandOptions {
  timeoutMs?: number;
  graceMs?: number;
  idleTimeoutMs?: number;
  captureEvents?: boolean;
  maxQueueSize?: number;
  onActivity?: () => void;
}

interface PendingPull {
  resolve: (value: IteratorResult<ClaudeStreamEvent>) => void;
  reject: (reason: unknown) => void;
}

export class ClaudeProcess extends EventEmitter {
  private readonly opts: ClaudeProcessOptions;
  private readonly env: NodeJS.ProcessEnv;
  private readonly parser = new StreamParser();
  private readonly timeoutMgr: TimeoutManager;
  private readonly captureEvents: boolean;
  private readonly maxQueue: number;

  private child: ClaudeChild | null = null;
  private stdoutReader: Interface | null = null;
  private stderrReader: Interface | null = null;

  private queue: ClaudeStreamEvent[] = [];
  private pendingPulls: PendingPull[] = [];
  private streamEnded = false;
  private streamError: unknown = null;

  private readonly captured: ClaudeStreamEvent[] = [];
  private stderrBuffer = "";
  private stdoutRawBuffer = "";
  private resolvedSessionId: string | null = null;
  private startTimeMs = 0;
  private exitCode: number | null = null;
  private finalStatus: FinalStatus | null = null;
  private killReason: string | null = null;
  private exitPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private waitPromise: Promise<ExecutionResult> | null = null;

  private modelHint: string;
  private resultEventUsage: TokenUsage | null = null;
  private resultEventCost: number | null = null;
  private resultErrorMessage: string | undefined;

  constructor(opts: ClaudeProcessOptions, env: NodeJS.ProcessEnv = process.env) {
    super();
    this.opts = opts;
    this.env = env;
    this.captureEvents = opts.captureEvents ?? true;
    this.maxQueue = opts.maxQueueSize ?? MAX_QUEUE_SIZE;
    this.modelHint = opts.model ?? "claude-sonnet-4-6";

    const timeoutOpts: ConstructorParameters<typeof TimeoutManager>[0] = {
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      onTimeout: () => {
        this.killReason = "timeout";
        this.finalStatus = "timeout";
        this.emit("timeout");
      },
      idleTimeoutMs: opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      onIdleTimeout: () => {
        this.emit("idle_stall");
      },
    };
    if (typeof opts.graceMs === "number") {
      timeoutOpts.graceMs = opts.graceMs;
    }
    this.timeoutMgr = new TimeoutManager(timeoutOpts);
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  get sessionId(): string | null {
    return this.resolvedSessionId;
  }

  get isRunning(): boolean {
    return this.child !== null && this.exitCode === null;
  }

  async start(): Promise<void> {
    if (this.child !== null) {
      throw new ExecutorError(ExecutorErrorCode.UNKNOWN, "ClaudeProcess.start called twice");
    }

    const args = buildClaudeArgs(this.opts);
    const { command, useShell } = resolveClaudeBinary();

    this.startTimeMs = Date.now();

    let child: ClaudeChild;
    try {
      child = spawn(command, args, {
        cwd: this.opts.workingDir,
        env: this.env,
        shell: useShell,
        windowsHide: true,
        // stdin is "pipe" so we can feed the prompt without putting it on the
        // command line. On Windows this is the difference between working and
        // hitting cmd.exe's 8191-char limit on prompts >~7KB.
        stdio: ["pipe", "pipe", "pipe"],
      }) as ClaudeChild;
    } catch (err) {
      throw mapSpawnError(err);
    }

    this.child = child;

    // Feed the prompt via stdin and close it. The CLI reads the prompt from
    // stdin when no positional `[prompt]` argument is provided (see
    // command-builder.ts). Errors during write are surfaced through the
    // same channel as spawn errors so the executor can fail fast.
    try {
      const stdin = child.stdin;
      stdin.on("error", (err: NodeJS.ErrnoException) => {
        // EPIPE is expected if the child died before we finished writing
        // (e.g. flag validation failed). Surface other errors but don't
        // crash the worker — the exit handler will produce the final status.
        if (err.code !== "EPIPE") {
          log.warn({ err, pid: child.pid }, "claude.stdin.error");
        }
      });
      stdin.end(this.opts.prompt, "utf8");
    } catch (err) {
      log.error({ err, pid: child.pid }, "claude.stdin.write_failed");
      this.streamError = ExecutorError.from(err);
    }

    child.on("error", (err: NodeJS.ErrnoException) => {
      const mapped = mapSpawnError(err);
      this.streamError = mapped;
      this.emit("error", mapped);
      this.endStream();
    });

    child.on("exit", (code, signal) => {
      this.exitCode = code ?? (signal ? 1 : 0);
      this.timeoutMgr.clear();
      log.debug({ code, signal, pid: child.pid }, "claude exited");
      // Drain whatever the parser still has buffered BEFORE we mark the
      // stream ended. On Windows the `exit` event fires before stdout's
      // `close` event drains, and `endStream()` resolves any pending
      // consumers with `done: true` — any later events flushed from the
      // partial-line buffer would land in a queue nobody reads. This
      // matters most for the `result` event, which carries the final
      // session/usage payload and is frequently the last line.
      try {
        const flushed = this.parser.flush();
        for (const ev of flushed) this.dispatchEvent(ev);
      } catch (flushErr) {
        log.warn({ err: flushErr, pid: child.pid }, "claude.process.flush_on_exit_failed");
      }
      if (this.finalStatus === null) {
        if (this.timeoutMgr.didIdleTimeout) {
          this.finalStatus = "timeout";
        } else if (this.timeoutMgr.didTimeout) {
          this.finalStatus = "timeout";
        } else if (this.killReason !== null) {
          this.finalStatus = "killed";
        } else if ((code ?? 0) === 0) {
          // If the process exited cleanly but we observed a stream-level
          // error (rate-limit / auth detected in stderr, stdin write
          // failure, etc.) — promote to "error" so the orchestrator
          // doesn't treat the run as silently successful. Without this,
          // a rate-limited Claude that prints the message to stderr and
          // exits 0 would report success with no retry path.
          this.finalStatus = this.streamError !== null ? "error" : "success";
        } else {
          this.finalStatus = "error";
        }
      }
      this.emit("exit", this.exitCode, signal);
      this.endStream();

      // Defense-in-depth: if `close` doesn't fire on stdout/stderr within
      // POST_EXIT_STREAM_GRACE_MS, force-destroy the streams. This breaks
      // the MCP-subprocess deadlock where children inherit the pipes and
      // keep them open after the parent exits. See constant docs above.
      setTimeout(() => {
        if (!child.stdout.destroyed) {
          log.warn(
            { pid: child.pid },
            "claude.process.force_destroy_stdout (MCP child holding pipe?)",
          );
          child.stdout.destroy();
        }
        if (!child.stderr.destroyed) {
          log.warn(
            { pid: child.pid },
            "claude.process.force_destroy_stderr (MCP child holding pipe?)",
          );
          child.stderr.destroy();
        }
      }, POST_EXIT_STREAM_GRACE_MS).unref();
    });

    this.exitPromise = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
    });

    // Wait for both exit AND stdio stream close so stderrBuffer is fully
    // populated before wait() reads it. On Windows, the exit event often
    // fires before the readline interfaces finish processing buffered data.
    //
    // Belt-and-suspenders against the MCP-subprocess hang: if `close` still
    // doesn't fire after the watchdog destroyed the streams (extreme
    // pathological case), fall back to a hard deadline of `exit +
    // 2 × POST_EXIT_STREAM_GRACE_MS`. By then either the streams closed or
    // we accept that we'll never see them and proceed with whatever was
    // captured so far.
    const stdoutClosed = new Promise<void>((r) => child.stdout.once("close", r));
    const stderrClosed = new Promise<void>((r) => child.stderr.once("close", r));
    const hardDeadline = this.exitPromise.then(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 2 * POST_EXIT_STREAM_GRACE_MS).unref();
        }),
    );
    this.closePromise = Promise.race([
      Promise.all([this.exitPromise, stdoutClosed, stderrClosed]).then(() => {}),
      hardDeadline,
    ]);

    this.stdoutReader = createInterface({
      input: child.stdout,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    this.stdoutReader.on("line", (line) => this.handleStdoutLine(line));
    this.stdoutReader.on("close", () => {
      const flushed = this.parser.flush();
      for (const ev of flushed) this.dispatchEvent(ev);
    });

    this.stderrReader = createInterface({
      input: child.stderr,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    this.stderrReader.on("line", (line) => this.handleStderrLine(line));

    this.timeoutMgr.start(child.pid ?? null);
  }

  private handleStdoutLine(line: string): void {
    if (line.length > 0) {
      this.stdoutRawBuffer += `${line}\n`;
      if (this.stdoutRawBuffer.length > 128 * 1024) {
        this.stdoutRawBuffer = this.stdoutRawBuffer.slice(-64 * 1024);
      }
    }
    const event = this.parser.feed(line);
    if (event !== null) this.dispatchEvent(event);
    this.timeoutMgr.notifyActivity(this.child?.pid ?? null);
    this.opts.onActivity?.();
  }

  private handleStderrLine(line: string): void {
    if (line.length === 0) return;
    this.timeoutMgr.notifyActivity(this.child?.pid ?? null);
    this.opts.onActivity?.();
    if (this.stderrBuffer.length < 64 * 1024) {
      this.stderrBuffer += `${line}\n`;
    }
    if (RATE_LIMIT_PATTERN.test(line)) {
      const err = new ExecutorError(ExecutorErrorCode.RATE_LIMITED, line.trim(), {
        retryable: true,
      });
      this.streamError = err;
      this.emit("error", err);
      // Stop the child fast so we don't keep burning the wall clock on a
      // process that's already been told the API rejected it. The kill is
      // fire-and-forget; the exit handler will promote finalStatus to
      // "error" because streamError is set.
      void this.kill("rate-limit").catch(() => undefined);
    } else if (AUTH_PATTERN.test(line)) {
      const err = new ExecutorError(ExecutorErrorCode.AUTH_INVALID, line.trim());
      this.streamError = err;
      this.emit("error", err);
      void this.kill("auth-invalid").catch(() => undefined);
    }
    this.emit("stderr", line);
  }

  private extractErrorFromStdout(): string | undefined {
    for (const ev of this.captured) {
      if (ev.type === "parse_error" && ev.raw.length > 0) {
        return ev.raw.slice(0, 500);
      }
    }
    if (this.resultErrorMessage) return this.resultErrorMessage;
    return undefined;
  }

  private dispatchEvent(event: ClaudeStreamEvent): void {
    if (this.captureEvents && this.captured.length < this.maxQueue) {
      this.captured.push(event);
    }

    if (event.type === "system" && event.subtype === "init") {
      this.resolvedSessionId = event.session_id;
      if (event.model) this.modelHint = event.model;
    } else if (event.type === "result") {
      // `usage` is optional on the result event schema (Claude CLI error
      // subtypes sometimes omit it); fall back to assistant-event
      // aggregation in wait() when null.
      if (event.usage !== undefined) {
        this.resultEventUsage = event.usage;
      }
      if (typeof event.total_cost_usd === "number") {
        this.resultEventCost = event.total_cost_usd;
      }
      if (event.subtype.startsWith("error")) {
        const errors = (event as Record<string, unknown>)["errors"];
        if (Array.isArray(errors) && errors.length > 0) {
          this.resultErrorMessage = String(errors[0]);
        } else if (typeof event.result === "string") {
          this.resultErrorMessage = event.result;
        } else {
          this.resultErrorMessage = `Claude error: ${event.subtype}`;
        }
      }
    }

    this.emit("event", event);

    const pull = this.pendingPulls.shift();
    if (pull) {
      pull.resolve({ value: event, done: false });
      return;
    }

    if (this.queue.length >= this.maxQueue) {
      this.queue.shift();
    }
    this.queue.push(event);
  }

  private endStream(): void {
    if (this.streamEnded) return;
    this.streamEnded = true;
    while (this.pendingPulls.length > 0) {
      const pull = this.pendingPulls.shift();
      if (!pull) break;
      if (this.streamError) {
        pull.reject(this.streamError);
      } else {
        pull.resolve({ value: undefined, done: true });
      }
    }
  }

  events(): AsyncIterableIterator<ClaudeStreamEvent> {
    const self = this;
    const iterator: AsyncIterableIterator<ClaudeStreamEvent> = {
      [Symbol.asyncIterator](): AsyncIterableIterator<ClaudeStreamEvent> {
        return iterator;
      },
      next(): Promise<IteratorResult<ClaudeStreamEvent>> {
        const queued = self.queue.shift();
        if (queued !== undefined) {
          return Promise.resolve({ value: queued, done: false });
        }
        if (self.streamEnded) {
          if (self.streamError) {
            return Promise.reject(self.streamError);
          }
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<ClaudeStreamEvent>>((resolve, reject) => {
          self.pendingPulls.push({ resolve, reject });
        });
      },
      async return(): Promise<IteratorResult<ClaudeStreamEvent>> {
        await self.kill("iterator-return");
        return { value: undefined, done: true };
      },
      async throw(err?: unknown): Promise<IteratorResult<ClaudeStreamEvent>> {
        self.streamError = err;
        await self.kill("iterator-throw");
        return { value: undefined, done: true };
      },
    };
    return iterator;
  }

  async wait(): Promise<ExecutionResult> {
    if (this.waitPromise) return this.waitPromise;
    this.waitPromise = (async (): Promise<ExecutionResult> => {
      if (this.closePromise) {
        await this.closePromise;
      } else if (this.exitPromise) {
        await this.exitPromise;
      }
      this.endStream();
      this.timeoutMgr.clear();

      if (this.timeoutMgr.didIdleTimeout) {
        const idleMs = this.opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
        log.warn(
          { pid: this.child?.pid ?? null, idleMs, bytesReceived: this.stdoutRawBuffer.length },
          "claude.process.idle_stall",
        );
        throw new ExecutorError(ExecutorErrorCode.IDLE_STALL, `no output for ${idleMs}ms`);
      }

      const durationMs = Date.now() - this.startTimeMs;
      const sessionId = this.resolvedSessionId ?? "";

      const usage = this.resultEventUsage ?? aggregateUsageFromEvents(this.captured);
      const costUsd =
        this.resultEventCost !== null ? this.resultEventCost : calcCost(this.modelHint, usage);

      // Belt-and-suspenders: even if the exit handler didn't promote
      // streamError → "error" (e.g. wait() resolved before exit emitted
      // for some pathological path), surface stream-level errors as
      // explicit failures rather than silent successes.
      let finalStatus: FinalStatus = this.finalStatus ?? "success";
      if (finalStatus === "success" && this.streamError !== null) {
        finalStatus = "error";
      }

      const errorMessage =
        this.resultErrorMessage ??
        (this.streamError instanceof Error
          ? this.streamError.message
          : finalStatus === "timeout"
            ? "execution timed out"
            : finalStatus === "killed"
              ? (this.killReason ?? "killed")
              : finalStatus === "error"
                ? this.stderrBuffer.trim() ||
                  this.extractErrorFromStdout() ||
                  `exit code ${this.exitCode ?? -1}`
                : undefined);

      const result: ExecutionResult = {
        exitCode: this.exitCode ?? -1,
        sessionId,
        durationMs,
        finalStatus,
        usage,
        costUsd,
        capturedEvents: this.captured,
      };
      if (errorMessage !== undefined) result.errorMessage = errorMessage;
      if (this.stderrBuffer.length > 0) result.stderrRaw = this.stderrBuffer;
      if (finalStatus === "error" && this.stdoutRawBuffer.length > 0) {
        result.stdoutRaw = this.stdoutRawBuffer.slice(-10_000);
      }
      return result;
    })();
    return this.waitPromise;
  }

  async kill(reason: string): Promise<void> {
    if (!this.child || this.exitCode !== null) return;
    this.killReason = reason;
    if (this.finalStatus === null) this.finalStatus = "killed";
    this.timeoutMgr.softThenHard(this.child.pid ?? null);
    if (this.exitPromise) {
      // Hard deadline so a stuck process (MCP children holding pipes,
      // taskkill that never returns, etc.) cannot block the orchestrator's
      // cancel/retry path indefinitely. Generous enough to cover the
      // softThenHard sequence (5s soft + grace + hard) plus a safety
      // margin. The stream-close watchdog (POST_EXIT_STREAM_GRACE_MS)
      // already handles the pipe-deadlock case in wait().
      const HARD_DEADLINE_MS = 60_000;
      await Promise.race([
        this.exitPromise,
        new Promise<void>((resolve) => setTimeout(resolve, HARD_DEADLINE_MS).unref()),
      ]);
    }
  }
}

function aggregateUsageFromEvents(events: ReadonlyArray<ClaudeStreamEvent>): TokenUsage {
  const withUsage: { usage?: TokenUsage }[] = [];
  for (const e of events) {
    if (isAssistantEvent(e) && e.message.usage) {
      withUsage.push({ usage: e.message.usage });
    } else if (isResultEvent(e)) {
      withUsage.push({ usage: e.usage });
    }
  }
  return aggregateUsage(withUsage);
}

function mapSpawnError(err: unknown): ExecutorError {
  if (err instanceof ExecutorError) return err;
  const e = err as NodeJS.ErrnoException;
  if (e?.code === "ENOENT") {
    return new ExecutorError(
      ExecutorErrorCode.CLI_NOT_FOUND,
      "claude CLI not found in PATH (ENOENT)",
      { originalError: err },
    );
  }
  if (e?.code === "EACCES") {
    return new ExecutorError(
      ExecutorErrorCode.CLI_NOT_FOUND,
      "claude CLI not executable (EACCES)",
      { originalError: err },
    );
  }
  return ExecutorError.from(err);
}

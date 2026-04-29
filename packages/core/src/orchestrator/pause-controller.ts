/**
 * Conductor — Pause Controller
 *
 * Provides pause / resume / cancel signaling for the orchestrator using the
 * Deferred pattern. The orchestrator awaits {@link PauseController.waitIfPaused}
 * between prompt executions to honor user-initiated control flow.
 */

/**
 * A Promise paired with externally accessible `resolve` / `reject` handles.
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

/**
 * Creates a new {@link Deferred}. The returned `resolve` / `reject` functions
 * are guaranteed to be assigned because the Promise executor runs synchronously.
 */
export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Error thrown by {@link PauseController.waitIfPaused} when the controller has
 * been cancelled.
 */
export class CancelledError extends Error {
  public readonly reason: string;

  constructor(reason: string) {
    super(reason || "Run cancelled");
    this.name = "CancelledError";
    this.reason = reason;
    Object.setPrototypeOf(this, CancelledError.prototype);
  }
}

/**
 * Cooperative pause / resume / cancel coordinator for the orchestrator.
 *
 * Lifecycle rules:
 *  - `pause()` while already paused or cancelled is a no-op.
 *  - `resume()` while not paused is a no-op.
 *  - `cancel()` unblocks any pending {@link waitIfPaused} with a
 *    {@link CancelledError} and is permanent until {@link reset} is called.
 *  - `waitIfPaused()` resolves immediately when neither paused nor cancelled,
 *    throws {@link CancelledError} immediately when cancelled, otherwise
 *    blocks until `resume()` or `cancel()` is called.
 */
export class PauseController {
  private paused = false;
  private cancelled = false;
  private cancelReason = "";
  private resumeDeferred: Deferred<void> | null = null;

  pause(): void {
    if (this.cancelled || this.paused) return;
    this.paused = true;
    this.resumeDeferred = createDeferred<void>();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    const deferred = this.resumeDeferred;
    this.resumeDeferred = null;
    if (deferred) {
      deferred.resolve();
    }
  }

  cancel(reason: string): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.cancelReason = reason;
    const deferred = this.resumeDeferred;
    this.resumeDeferred = null;
    this.paused = false;
    if (deferred) {
      deferred.reject(new CancelledError(reason));
    }
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  getCancelReason(): string {
    return this.cancelReason;
  }

  isPaused(): boolean {
    return this.paused && !this.cancelled;
  }

  async waitIfPaused(): Promise<void> {
    if (this.cancelled) {
      throw new CancelledError(this.cancelReason);
    }
    if (!this.paused || !this.resumeDeferred) {
      return;
    }
    await this.resumeDeferred.promise;
  }

  /**
   * Resets internal state. Intended for tests and controller reuse.
   */
  reset(): void {
    const deferred = this.resumeDeferred;
    this.paused = false;
    this.cancelled = false;
    this.cancelReason = "";
    this.resumeDeferred = null;
    if (deferred) {
      // Reject any in-flight waiters so they don't hang forever after a reset.
      deferred.reject(new CancelledError("Controller reset"));
    }
  }
}

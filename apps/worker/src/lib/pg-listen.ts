/**
 * Conductor — Worker / PgListener
 *
 * A simplified "queue notifier" used by the worker process. Instead of opening
 * a raw Postgres `LISTEN`/`NOTIFY` connection (which would require the `pg`
 * package), this implementation polls on a fixed interval and invokes the
 * caller-supplied `onNotify` callback. The callback is responsible for
 * actually checking the `runs` table for queued work.
 *
 * The interface mirrors what a true LISTEN/NOTIFY listener would expose
 * (`channel`, `start`, `stop`) so swapping the implementation later is a
 * drop-in change. The Supabase URL/key are accepted today purely for that
 * forward-compatibility — the polling path doesn't need them — but they let
 * a future LISTEN/NOTIFY backend authenticate without an interface change.
 */

const DEFAULT_POLL_INTERVAL_MS = 3_000;

/**
 * Constructor options for {@link PgListener}.
 *
 * `channel` is kept on the option bag for interface compatibility with a
 * future `LISTEN`/`NOTIFY` implementation; it is not used by the polling
 * backend.
 */
export interface PgListenerOptions {
  supabaseUrl: string;
  supabaseServiceKey: string;
  channel: string;
  onNotify: () => void | Promise<void>;
  pollIntervalMs?: number;
}

/**
 * Polls a callback on a fixed interval. Each tick invokes `onNotify`, which
 * the worker uses to scan for newly-queued runs. Errors thrown by the
 * callback are caught and logged so a transient failure cannot kill the
 * polling loop.
 */
export class PgListener {
  private readonly supabaseUrl: string;
  private readonly supabaseServiceKey: string;
  private readonly channel: string;
  private readonly onNotify: () => void | Promise<void>;
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(opts: PgListenerOptions) {
    this.supabaseUrl = opts.supabaseUrl;
    this.supabaseServiceKey = opts.supabaseServiceKey;
    this.channel = opts.channel;
    this.onNotify = opts.onNotify;
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    // Held for forward compatibility — referenced so strict unused-locals
    // checks don't flag them. A future LISTEN/NOTIFY backend will use these.
    void this.supabaseUrl;
    void this.supabaseServiceKey;
    void this.channel;
  }

  /**
   * Start polling. Fires `onNotify` immediately so the worker doesn't have
   * to wait a full interval on startup, then on every `pollIntervalMs` tick.
   * Idempotent — calling `start()` while already running is a no-op.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Fire once on startup so a queued run waiting at boot is picked up
    // without a full interval of latency.
    await this.safeInvoke();

    this.timer = setInterval(() => {
      void this.safeInvoke();
    }, this.pollIntervalMs);
  }

  /** Stop polling. Idempotent. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  private async safeInvoke(): Promise<void> {
    try {
      await this.onNotify();
    } catch (err) {
      // The poller must survive callback failures — log and keep going.
      console.error("[PgListener] onNotify callback threw:", err);
    }
  }
}

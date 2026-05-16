/**
 * Conductor — Worker / RunControlChannel
 *
 * Bridges Supabase Realtime `runs` UPDATE events into the in-memory
 * orchestrator's pause/resume/cancel handles, so user-initiated control
 * actions (POST /api/runs/:id/pause, etc.) take effect inside the worker
 * within ms instead of relying on a polling tick.
 *
 * Lifecycle is bound 1:1 to a single run: `start()` is called right before
 * the orchestrator runs, `stop()` is called in the run's `finally` so the
 * channel is torn down even on unexpected errors.
 *
 * Design notes:
 *  - Subscribes via `postgres_changes` filtered by `id=eq.<runId>`. The
 *    `runs` table is already in the `supabase_realtime` publication with
 *    `REPLICA IDENTITY FULL` (see migration 20260430000002).
 *  - On `SUBSCRIBED` (initial + every automatic reconnect) we read the
 *    current `runs.status` and reconcile in-memory state. This closes two
 *    gaps:
 *      1. The race between the worker claiming a run (`status='running'`)
 *         and the channel actually being open — a pause that arrives in
 *         that window would otherwise be missed.
 *      2. Events lost while the realtime connection was disconnected. The
 *         JS client reconnects automatically but does not replay missed
 *         INSERT/UPDATE rows.
 *  - We track `lastObservedStatus` so we only fire transitions, not every
 *    UPDATE (the row gets touched for `last_heartbeat_at`,
 *    `checkpoint_branch`, etc.).
 *  - Callbacks are sync. Anything async (DB writes, logging) is the
 *    caller's responsibility.
 */

import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import type { Logger } from "pino";

const RECONCILE_INTERVAL_MS = 5_000;

/**
 * Subset of `runs.status` we care about for control-flow signaling. The
 * actual DB enum has more values (`completed`, `failed`, `queued`) but
 * those are terminal/initial states the orchestrator does not react to.
 */
export type ControlStatus = "running" | "paused" | "cancelled";

export interface RunControlChannelOptions {
  runId: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  logger: Logger;

  /** Called when DB transitions running → paused. */
  onPause: () => void;

  /** Called when DB transitions paused → running. */
  onResume: () => void;

  /**
   * Called when DB transitions to `cancelled` from any non-terminal state.
   * Receives the `cancellation_reason` column if present.
   */
  onCancel: (reason: string) => void;
}

interface RunStatusRow {
  status: string;
  cancellation_reason: string | null;
}

/**
 * Per-run realtime subscription that turns DB status transitions into
 * in-memory orchestrator control calls.
 *
 * Single-use: instantiate, `start()`, `stop()` — do not reuse after stop.
 */
export class RunControlChannel {
  private readonly runId: string;
  private readonly logger: Logger;
  private readonly onPause: () => void;
  private readonly onResume: () => void;
  private readonly onCancel: (reason: string) => void;
  private readonly supabase: SupabaseClient;

  // biome-ignore lint/suspicious/noExplicitAny: SupabaseClient.channel returns RealtimeChannel; importing the type adds friction without value here.
  private channel: any = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private lastObservedStatus: ControlStatus | null = null;
  private stopped = false;

  constructor(opts: RunControlChannelOptions) {
    this.runId = opts.runId;
    this.logger = opts.logger;
    this.onPause = opts.onPause;
    this.onResume = opts.onResume;
    this.onCancel = opts.onCancel;
    // Dedicated client — the realtime connection is long-lived and we don't
    // want to share it with the run-claim polling client (different lifetime,
    // different failure modes).
    this.supabase = createClient(opts.supabaseUrl, opts.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }

  /**
   * Subscribe to `runs` UPDATEs for this run. Resolves once the channel is
   * `SUBSCRIBED` for the first time (or after a reasonable timeout — we
   * never reject; the orchestrator must be allowed to start even if
   * realtime is down, since pause/cancel can fall back to graceful
   * shutdown).
   */
  async start(): Promise<void> {
    if (this.channel !== null) return;

    this.channel = this.supabase
      .channel(`conductor_run_control:${this.runId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "runs",
          filter: `id=eq.${this.runId}`,
        },
        (msg: { new: Record<string, unknown> | null }) => {
          this.handleRow(msg.new as RunStatusRow | null, "realtime");
        },
      )
      .subscribe((status: string) => {
        if (this.stopped) return;
        if (status === "SUBSCRIBED") {
          this.logger.debug({ runId: this.runId }, "run-control-channel.subscribed");
          // Reconcile: fetch current DB status to cover the gap between
          // run claim and channel-open, and to recover from any events
          // missed during a transient disconnect.
          void this.reconcile();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.logger.warn({ runId: this.runId, status }, "run-control-channel.subscribe_problem");
        }
      });

    // Start a short reconcile loop as belt-and-suspenders. If realtime is
    // wedged for any reason, we still observe a pause within ~5s. This
    // costs one tiny SELECT every 5s per active run — negligible.
    this.reconcileTimer = setInterval(() => {
      if (this.stopped) return;
      void this.reconcile();
    }, RECONCILE_INTERVAL_MS);
  }

  /**
   * Tear down the channel. Idempotent; safe to call from finally even if
   * `start()` was never called or already failed.
   */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.reconcileTimer !== null) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    if (this.channel !== null) {
      try {
        await this.supabase.removeChannel(this.channel);
      } catch (err) {
        this.logger.warn({ runId: this.runId, err }, "run-control-channel.remove_failed");
      }
      this.channel = null;
    }
  }

  /**
   * Read the current `runs.status` and apply any missed transition. Called
   * on initial subscribe, after reconnects, and on a 5s safety interval.
   * Errors are logged but never thrown — a single failed SELECT must not
   * disrupt the run.
   */
  private async reconcile(): Promise<void> {
    if (this.stopped) return;
    try {
      const { data, error } = await this.supabase
        .from("runs")
        .select("status, cancellation_reason")
        .eq("id", this.runId)
        .single();

      if (error !== null) {
        this.logger.warn(
          { runId: this.runId, err: error },
          "run-control-channel.reconcile_query_failed",
        );
        return;
      }
      this.handleRow(data as RunStatusRow | null, "reconcile");
    } catch (err) {
      this.logger.warn({ runId: this.runId, err }, "run-control-channel.reconcile_threw");
    }
  }

  /**
   * Translate a `runs` row into a control transition, idempotently. We
   * only fire the callback when status actually changed since the last
   * observed value, so the realtime path and reconcile path can both
   * deliver the same update without double-firing.
   */
  private handleRow(row: RunStatusRow | null, source: "realtime" | "reconcile"): void {
    if (this.stopped || row === null) return;

    const status = row.status;
    if (status !== "running" && status !== "paused" && status !== "cancelled") {
      // Terminal/initial states (queued, completed, failed) are not
      // control transitions — orchestrator handles them itself. Still
      // record the value so we don't re-fire a control callback when the
      // run later flips through a state we DO care about.
      this.lastObservedStatus = null;
      return;
    }

    if (this.lastObservedStatus === status) return;
    const previous = this.lastObservedStatus;
    this.lastObservedStatus = status;

    this.logger.info(
      { runId: this.runId, previous, status, source },
      "run-control-channel.transition",
    );

    try {
      if (status === "paused") {
        this.onPause();
      } else if (status === "running") {
        // Only treat running as a resume signal if we previously saw
        // paused. The first transition (null → running) is just the
        // baseline established at subscribe time.
        if (previous === "paused") this.onResume();
      } else if (status === "cancelled") {
        this.onCancel(row.cancellation_reason ?? "user_cancelled");
      }
    } catch (err) {
      this.logger.error({ runId: this.runId, status, err }, "run-control-channel.callback_threw");
    }
  }
}

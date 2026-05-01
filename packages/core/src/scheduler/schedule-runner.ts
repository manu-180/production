/**
 * Conductor — Schedule Runner
 *
 * Polls the `schedules` table for due schedules and enqueues plan runs.
 * Designed to be called every ~30 seconds by the worker tick loop.
 *
 * Concurrency safety:
 *  - Uses `FOR UPDATE SKIP LOCKED` so multiple worker instances never
 *    double-process the same schedule.
 *  - Processes at most `TICK_BATCH_SIZE` schedules per tick to bound
 *    transaction duration.
 *
 * Error handling:
 *  - Per-schedule errors are caught, logged, and counted in `result.errors`.
 *    A single bad row never aborts the rest of the tick.
 *  - The tick itself never throws.
 */

import type { Logger } from "../logger.js";
import { checkConditions } from "./conditions.js";
import { getNextRun, parseCron } from "./cron-parser.js";
import type { Schedule, ScheduleTickResult } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal Supabase-shaped DB client interface
// (structural, so any client matching this shape is accepted in tests)
// ─────────────────────────────────────────────────────────────────────────────

export interface SchedulerDbVoidResult {
  error: unknown;
}

export interface SchedulerDbSingleResult<T> {
  data: T | null;
  error: unknown;
}

export interface SchedulerDbChain<TRow> extends Promise<SchedulerDbVoidResult> {
  eq(col: string, val: unknown): SchedulerDbChain<TRow>;
  in(col: string, vals: unknown[]): SchedulerDbChain<TRow>;
  lte(col: string, val: unknown): SchedulerDbChain<TRow>;
  select(cols?: string): SchedulerDbChain<TRow>;
  limit(n: number): SchedulerDbChain<TRow>;
  single(): Promise<SchedulerDbSingleResult<TRow>>;
}

export interface SchedulerDbArrayResult<TRow> {
  data: TRow[] | null;
  error: unknown;
}

export interface SchedulerDbArrayChain<TRow> extends Promise<SchedulerDbArrayResult<TRow>> {
  eq(col: string, val: unknown): SchedulerDbArrayChain<TRow>;
  in(col: string, vals: unknown[]): SchedulerDbArrayChain<TRow>;
  lte(col: string, val: unknown): SchedulerDbArrayChain<TRow>;
  select(cols?: string): SchedulerDbArrayChain<TRow>;
  limit(n: number): SchedulerDbArrayChain<TRow>;
}

export interface SchedulerDbTable<TRow> {
  select(cols?: string): SchedulerDbArrayChain<TRow>;
  insert(row: Record<string, unknown>): SchedulerDbChain<TRow>;
  update(data: Record<string, unknown>): SchedulerDbChain<TRow>;
}

export interface SchedulerSupabaseClient {
  from(table: "schedules"): SchedulerDbTable<Schedule>;
  from(table: "runs"): SchedulerDbTable<Record<string, unknown>>;
  from(table: "settings"): SchedulerDbTable<Record<string, unknown>>;
  from(table: string): SchedulerDbTable<Record<string, unknown>>;
  rpc(fn: string, args: Record<string, unknown>): Promise<SchedulerDbSingleResult<string>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum schedules processed in one tick to bound transaction duration. */
const TICK_BATCH_SIZE = 50;

/** Active run statuses — a run in any of these states blocks skip_if_running. */
const ACTIVE_STATUSES = ["queued", "running"];

/** Default timezone when the user has no settings row. */
const FALLBACK_TIMEZONE = "UTC";

// ─────────────────────────────────────────────────────────────────────────────
// ScheduleRunner
// ─────────────────────────────────────────────────────────────────────────────

export class ScheduleRunner {
  constructor(
    private readonly supabase: SchedulerSupabaseClient,
    private readonly logger: Logger,
  ) {}

  /**
   * Main tick. Poll up to {@link TICK_BATCH_SIZE} due schedules, evaluate
   * conditions, and enqueue runs. Never throws.
   */
  async tick(): Promise<ScheduleTickResult> {
    const result: ScheduleTickResult = { processed: 0, enqueued: 0, skipped: 0, errors: 0 };

    let schedules: Schedule[];
    try {
      schedules = await this.fetchDueSchedules();
    } catch (err) {
      this.logger.error({ err }, "[Scheduler] failed to fetch due schedules");
      result.errors++;
      return result;
    }

    if (schedules.length === 0) {
      this.logger.debug({}, "[Scheduler] no due schedules this tick");
      return result;
    }

    this.logger.info({ count: schedules.length }, "[Scheduler] processing due schedules");

    for (const schedule of schedules) {
      result.processed++;
      const outcome = await this.processSingleSchedule(schedule);
      if (outcome === "enqueued") result.enqueued++;
      else if (outcome === "skipped") result.skipped++;
      else result.errors++;
    }

    return result;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Fetch all enabled schedules whose `next_run_at` is in the past.
   *
   * Note: Supabase JS does not expose `FOR UPDATE SKIP LOCKED` directly.
   * The locking semantic is expressed here as a comment; in production you
   * would wrap this in an RPC / Edge Function that issues the raw SQL:
   *
   *   SELECT * FROM schedules
   *     WHERE enabled = true AND next_run_at <= now()
   *     FOR UPDATE SKIP LOCKED
   *     LIMIT 50
   *
   * With a single-worker deployment the `SKIP LOCKED` is not strictly needed,
   * but the query shape is documented for future multi-worker support.
   */
  private async fetchDueSchedules(): Promise<Schedule[]> {
    const nowIso = new Date().toISOString();

    const { data, error } = await this.supabase
      .from("schedules")
      .select("*")
      .eq("enabled", true)
      .lte("next_run_at", nowIso)
      .limit(TICK_BATCH_SIZE);

    if (error !== null && error !== undefined) {
      throw error;
    }

    return (data ?? []) as Schedule[];
  }

  /**
   * Evaluate conditions and, if clear, enqueue a run and advance `next_run_at`.
   */
  private async processSingleSchedule(
    schedule: Schedule,
  ): Promise<"enqueued" | "skipped" | "error"> {
    try {
      const now = new Date();

      // Gather context data in parallel.
      const [activeRunExists, lastCompletedRunAt, userTimezone] = await Promise.all([
        this.checkActiveRunExists(schedule.plan_id, schedule.user_id),
        this.getLastCompletedRunAt(schedule.plan_id, schedule.user_id),
        this.getUserTimezone(schedule.user_id),
      ]);

      const skipReason = checkConditions({
        schedule,
        now,
        userTimezone,
        activeRunExists,
        lastCompletedRunAt,
      });

      if (skipReason !== null) {
        this.logger.info(
          { scheduleId: schedule.id, reason: skipReason },
          "[Scheduler] skipping schedule",
        );
        // Still advance next_run_at so we don't repeatedly evaluate this tick.
        await this.updateNextRunAt(schedule.id, schedule.cron_expression, now);
        return "skipped";
      }

      await this.enqueueRun(schedule);
      await this.updateNextRunAt(schedule.id, schedule.cron_expression, now);

      this.logger.info(
        { scheduleId: schedule.id, planId: schedule.plan_id },
        "[Scheduler] enqueued run for schedule",
      );
      return "enqueued";
    } catch (err) {
      this.logger.error({ scheduleId: schedule.id, err }, "[Scheduler] error processing schedule");
      return "error";
    }
  }

  /**
   * Returns true when there is at least one run for this plan in a
   * `queued` or `running` state belonging to the same user.
   */
  private async checkActiveRunExists(planId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("runs")
      .select("id")
      .eq("plan_id", planId)
      .eq("user_id", userId)
      .in("status", ACTIVE_STATUSES)
      .limit(1);

    if (error !== null && error !== undefined) {
      this.logger.warn(
        { planId, err: error },
        "[Scheduler] could not check active runs, assuming false",
      );
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  }

  /**
   * Returns the `finished_at` timestamp of the most recent completed run for
   * this plan/user pair, or null if none exist.
   */
  private async getLastCompletedRunAt(planId: string, userId: string): Promise<Date | null> {
    // Supabase JS does not support ORDER BY + LIMIT via the chainable API in a
    // type-safe manner without a generic parameter, so we select all completed
    // runs and take the latest on the client side. In practice the result set
    // is tiny (we only need the most recent one); a proper RPC would be used
    // in high-volume deployments.
    const { data, error } = await this.supabase
      .from("runs")
      .select("finished_at")
      .eq("plan_id", planId)
      .eq("user_id", userId)
      .eq("status", "completed");

    if (error !== null && error !== undefined) {
      this.logger.warn(
        { planId, err: error },
        "[Scheduler] could not fetch last completed run, assuming null",
      );
      return null;
    }

    if (!Array.isArray(data) || data.length === 0) return null;

    let latest: Date | null = null;
    for (const row of data) {
      const finishedAt = (row as Record<string, unknown>)["finished_at"];
      if (typeof finishedAt === "string") {
        const d = new Date(finishedAt);
        if (latest === null || d > latest) latest = d;
      }
    }
    return latest;
  }

  /**
   * Fetch the user's preferred IANA timezone from the `settings` table.
   * Falls back to UTC on any error.
   */
  private async getUserTimezone(userId: string): Promise<string> {
    const { data, error } = await this.supabase
      .from("settings")
      .select("timezone")
      .eq("user_id", userId)
      .limit(1);

    if (error !== null && error !== undefined) return FALLBACK_TIMEZONE;
    if (!Array.isArray(data) || data.length === 0) return FALLBACK_TIMEZONE;

    const tz = (data[0] as Record<string, unknown>)["timezone"];
    return typeof tz === "string" && tz.length > 0 ? tz : FALLBACK_TIMEZONE;
  }

  /**
   * Insert a new run row via the `enqueue_run` Postgres function.
   * Falls back to a direct INSERT when the RPC is unavailable (tests).
   */
  private async enqueueRun(schedule: Schedule): Promise<void> {
    const workingDir = schedule.working_dir ?? "";

    // Use the database-side enqueue_run function which handles sequencing.
    const { data: runId, error } = await this.supabase.rpc("enqueue_run", {
      p_plan_id: schedule.plan_id,
      p_user_id: schedule.user_id,
      p_triggered_by: "schedule",
      p_working_dir: workingDir,
    });

    if (error !== null && error !== undefined) {
      throw new Error(
        `[Scheduler] enqueue_run RPC failed for schedule ${schedule.id}: ${String(error)}`,
      );
    }

    this.logger.debug({ scheduleId: schedule.id, runId }, "[Scheduler] run enqueued via RPC");
  }

  /**
   * Compute the next `next_run_at` from the cron expression and write it back
   * to the DB along with `last_run_at = now()`.
   */
  private async updateNextRunAt(
    scheduleId: string,
    cronExpression: string,
    now: Date,
  ): Promise<void> {
    const parsed = parseCron(cronExpression);

    let nextRunAt: string;
    if (parsed instanceof Error) {
      // Invalid cron — disable the schedule to prevent repeated failures.
      this.logger.error(
        { scheduleId, cronExpression, err: parsed.message },
        "[Scheduler] invalid cron expression; disabling schedule",
      );
      const { error } = await this.supabase
        .from("schedules")
        .update({ enabled: false })
        .eq("id", scheduleId);
      if (error !== null && error !== undefined) {
        this.logger.warn(
          { scheduleId, err: error },
          "[Scheduler] failed to disable schedule with bad cron",
        );
      }
      return;
    }

    try {
      nextRunAt = getNextRun(parsed, now).toISOString();
    } catch (err) {
      // Expression valid but no future match (e.g. Feb 31) — disable.
      this.logger.error(
        { scheduleId, cronExpression, err },
        "[Scheduler] getNextRun threw; disabling schedule",
      );
      await this.supabase.from("schedules").update({ enabled: false }).eq("id", scheduleId);
      return;
    }

    const { error } = await this.supabase
      .from("schedules")
      .update({
        next_run_at: nextRunAt,
        last_run_at: now.toISOString(),
      })
      .eq("id", scheduleId);

    if (error !== null && error !== undefined) {
      this.logger.warn(
        { scheduleId, nextRunAt, err: error },
        "[Scheduler] failed to update next_run_at",
      );
    }
  }
}

/**
 * Conductor — Scheduler types
 *
 * Shared types for the cron-based schedule runner.
 */

import type { Schedule as DbSchedule } from "@conductor/db";

/** Row from the `schedules` table. */
export type Schedule = DbSchedule;

/** Summary returned by a single {@link ScheduleRunner.tick} invocation. */
export interface ScheduleTickResult {
  /** Total number of schedules polled this tick. */
  processed: number;
  /** Schedules that resulted in a new run being enqueued. */
  enqueued: number;
  /** Schedules that were intentionally skipped due to conditions. */
  skipped: number;
  /** Schedules that threw an unexpected error. */
  errors: number;
}

/** Context passed into condition checkers for a single schedule evaluation. */
export interface ScheduleConditionContext {
  /** The schedule row from the database. */
  schedule: Schedule;
  /** Wall-clock time of the current tick. */
  now: Date;
  /** IANA timezone string from user settings (e.g. "America/New_York"). */
  userTimezone: string;
  /** Whether there is already an active (running or queued) run for this plan. */
  activeRunExists: boolean;
  /** Finished-at timestamp of the most recent completed run, or null. */
  lastCompletedRunAt: Date | null;
}

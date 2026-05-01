/**
 * Conductor — Schedule Condition Checkers
 *
 * Given a {@link ScheduleConditionContext}, decides whether a schedule should
 * be skipped for this tick. Returns a human-readable reason string when the
 * schedule should be skipped, or `null` when it should proceed.
 *
 * Checks are evaluated in priority order; the first matching check short-
 * circuits so only one reason is ever returned.
 */

import type { ScheduleConditionContext } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Individual condition checks (exported for unit testing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Skip if the plan already has an active (running or queued) run.
 * Controlled by `schedule.skip_if_running`.
 */
export function checkSkipIfRunning(ctx: ScheduleConditionContext): string | null {
  if (ctx.schedule.skip_if_running && ctx.activeRunExists) {
    return "active run in progress";
  }
  return null;
}

/**
 * Skip if the most recent completed run finished within
 * `schedule.skip_if_recent_hours` hours of `now`.
 */
export function checkSkipIfRecent(ctx: ScheduleConditionContext): string | null {
  const hours = ctx.schedule.skip_if_recent_hours;
  if (hours === null || hours === undefined || hours <= 0) return null;
  if (ctx.lastCompletedRunAt === null) return null;

  const cutoffMs = hours * 60 * 60 * 1000;
  const msSinceLast = ctx.now.getTime() - ctx.lastCompletedRunAt.getTime();
  if (msSinceLast < cutoffMs) {
    return `last run too recent (${Math.round(msSinceLast / 60_000)}m ago, skip window is ${hours}h)`;
  }
  return null;
}

/**
 * Returns the current hour (0-23) in the given IANA timezone using only the
 * built-in `Intl.DateTimeFormat` API — no external libraries needed.
 */
function getLocalHour(date: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    }).formatToParts(date);

    const hourPart = parts.find((p) => p.type === "hour");
    if (hourPart === undefined) return date.getUTCHours();

    const h = Number.parseInt(hourPart.value, 10);
    // Intl may return "24" for midnight in some environments; normalise.
    return h === 24 ? 0 : h;
  } catch {
    // Unknown timezone — fall back to UTC hour so we degrade gracefully.
    return date.getUTCHours();
  }
}

/**
 * Skip if the current local hour falls within the quiet window
 * `[quiet_hours_start, quiet_hours_end)`.
 *
 * Supports wrap-around: a window of start=22, end=7 means
 * hours 22, 23, 0, 1 … 6 are all quiet.
 */
export function checkQuietHours(ctx: ScheduleConditionContext): string | null {
  const start = ctx.schedule.quiet_hours_start;
  const end = ctx.schedule.quiet_hours_end;

  if (start === null || start === undefined || end === null || end === undefined) {
    return null;
  }
  if (start === end) {
    // Degenerate window — treat as disabled.
    return null;
  }

  const localHour = getLocalHour(ctx.now, ctx.userTimezone);

  let inQuiet: boolean;
  if (start < end) {
    // Normal window: e.g. 2–6 means hours 2,3,4,5 are quiet.
    inQuiet = localHour >= start && localHour < end;
  } else {
    // Wrap-around window: e.g. 22–7 means hours 22,23,0..6 are quiet.
    inQuiet = localHour >= start || localHour < end;
  }

  if (inQuiet) {
    return `quiet hours (${start}:00–${end}:00 in ${ctx.userTimezone}, current hour ${localHour})`;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Composite checker
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate all conditions in priority order and return the first skip reason,
 * or `null` if the schedule should proceed.
 *
 * Order:
 *  1. skip_if_running  — safety first; prevents duplicate runs
 *  2. skip_if_recent   — cooldown window
 *  3. quiet_hours      — time-of-day window
 */
export function checkConditions(ctx: ScheduleConditionContext): string | null {
  return checkSkipIfRunning(ctx) ?? checkSkipIfRecent(ctx) ?? checkQuietHours(ctx);
}

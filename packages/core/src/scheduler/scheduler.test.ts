/**
 * Conductor - Scheduler tests
 *
 * Covers:
 *  - cron-parser: validation, getNextRun for "star-slash-5" and weekday expressions
 *  - conditions: each condition individually, wrap-around quiet hours, first-match wins
 *  - schedule-runner: tick() with zero / one / skipped schedule
 */

import { describe, expect, it, vi } from "vitest";
import {
  checkConditions,
  checkQuietHours,
  checkSkipIfRecent,
  checkSkipIfRunning,
} from "./conditions.js";
import { getNextRun, isValidCron, parseCron } from "./cron-parser.js";
import { ScheduleRunner } from "./schedule-runner.js";
import type { ScheduleConditionContext } from "./types.js";
import type { Schedule } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a minimal Schedule row with overrides. */
function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: "sched-1",
    user_id: "user-1",
    plan_id: "plan-1",
    name: "Test schedule",
    cron_expression: "*/5 * * * *",
    enabled: true,
    next_run_at: new Date(Date.now() - 60_000).toISOString(),
    last_run_at: null,
    working_dir: "/workspace",
    skip_if_running: false,
    skip_if_recent_hours: null,
    quiet_hours_start: null,
    quiet_hours_end: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Build a minimal ScheduleConditionContext with overrides. */
function makeCtx(overrides: Partial<ScheduleConditionContext> = {}): ScheduleConditionContext {
  return {
    schedule: makeSchedule(),
    now: new Date("2025-06-10T14:30:00Z"), // Tuesday, 14:30 UTC
    userTimezone: "UTC",
    activeRunExists: false,
    lastCompletedRunAt: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// cron-parser
// ─────────────────────────────────────────────────────────────────────────────

describe("isValidCron", () => {
  it("accepts a wildcard expression", () => {
    expect(isValidCron("* * * * *")).toBe(true);
  });

  it("accepts */5 step", () => {
    expect(isValidCron("*/5 * * * *")).toBe(true);
  });

  it("accepts range in day-of-week", () => {
    expect(isValidCron("0 9 * * 1-5")).toBe(true);
  });

  it("rejects minute > 59", () => {
    expect(isValidCron("60 * * * *")).toBe(false);
  });

  it("rejects hour > 23", () => {
    expect(isValidCron("0 24 * * *")).toBe(false);
  });

  it("rejects day-of-week > 6", () => {
    expect(isValidCron("0 0 * * 7")).toBe(false);
  });

  it("rejects wrong field count (4 fields)", () => {
    expect(isValidCron("* * * *")).toBe(false);
  });

  it("rejects wrong field count (6 fields)", () => {
    expect(isValidCron("* * * * * *")).toBe(false);
  });

  it("rejects non-numeric value", () => {
    expect(isValidCron("abc * * * *")).toBe(false);
  });
});

describe("parseCron", () => {
  it("parses */5 * * * * correctly", () => {
    const expr = parseCron("*/5 * * * *");
    expect(expr).not.toBeInstanceOf(Error);
    if (expr instanceof Error) return;
    // Every 5th minute: 0,5,10,...,55 → 12 values
    expect(expr.minutes.size).toBe(12);
    expect(expr.minutes.has(0)).toBe(true);
    expect(expr.minutes.has(5)).toBe(true);
    expect(expr.minutes.has(55)).toBe(true);
    expect(expr.minutes.has(1)).toBe(false);
  });

  it("parses 0 9 * * 1-5 correctly", () => {
    const expr = parseCron("0 9 * * 1-5");
    expect(expr).not.toBeInstanceOf(Error);
    if (expr instanceof Error) return;
    expect(expr.minutes).toEqual(new Set([0]));
    expect(expr.hours).toEqual(new Set([9]));
    expect(expr.daysOfWeek).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it("parses list syntax 1,3,5 in minute field", () => {
    const expr = parseCron("1,3,5 * * * *");
    expect(expr).not.toBeInstanceOf(Error);
    if (expr instanceof Error) return;
    expect(expr.minutes).toEqual(new Set([1, 3, 5]));
  });

  it("parses step over a range 0-30/10", () => {
    const expr = parseCron("0-30/10 * * * *");
    expect(expr).not.toBeInstanceOf(Error);
    if (expr instanceof Error) return;
    expect(expr.minutes).toEqual(new Set([0, 10, 20, 30]));
  });

  it("returns Error for out-of-range minute", () => {
    const result = parseCron("60 * * * *");
    expect(result).toBeInstanceOf(Error);
  });
});

describe("getNextRun", () => {
  it("*/5 * * * * from :02 → next run at :05", () => {
    const expr = parseCron("*/5 * * * *");
    expect(expr).not.toBeInstanceOf(Error);
    if (expr instanceof Error) return;

    // from = 2025-06-10 14:02:30 UTC
    const from = new Date("2025-06-10T14:02:30Z");
    const next = getNextRun(expr, from);

    expect(next.getUTCHours()).toBe(14);
    expect(next.getUTCMinutes()).toBe(5);
    expect(next.getUTCSeconds()).toBe(0);
  });

  it("*/5 * * * * from :05 exactly → next at :10 (starts from next minute)", () => {
    const expr = parseCron("*/5 * * * *");
    expect(expr).not.toBeInstanceOf(Error);
    if (expr instanceof Error) return;

    const from = new Date("2025-06-10T14:05:00Z");
    const next = getNextRun(expr, from);
    expect(next.getUTCMinutes()).toBe(10);
  });

  it("0 9 * * 1-5 skips Saturday and Sunday", () => {
    const expr = parseCron("0 9 * * 1-5");
    expect(expr).not.toBeInstanceOf(Error);
    if (expr instanceof Error) return;

    // 2025-06-06 is a Friday → next should be Monday 2025-06-09
    const friday = new Date("2025-06-06T09:01:00Z");
    const next = getNextRun(expr, friday);

    // Should be the following Monday
    expect(next.getUTCDay()).toBe(1); // Monday
    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCMinutes()).toBe(0);
  });

  it("0 9 * * 1-5 from Friday 08:00 → same day at 09:00", () => {
    const expr = parseCron("0 9 * * 1-5");
    expect(expr).not.toBeInstanceOf(Error);
    if (expr instanceof Error) return;

    const friday = new Date("2025-06-06T08:00:00Z");
    const next = getNextRun(expr, friday);

    expect(next.getUTCDay()).toBe(5); // still Friday
    expect(next.getUTCHours()).toBe(9);
  });

  it("throws for an expression that never fires (invalid DOM)", () => {
    // Feb 31 never exists — expression is syntactically valid but matches nothing
    const expr = parseCron("0 0 31 2 *");
    expect(expr).not.toBeInstanceOf(Error);
    if (expr instanceof Error) return;

    expect(() => getNextRun(expr, new Date())).toThrow(/no valid execution time/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// conditions
// ─────────────────────────────────────────────────────────────────────────────

describe("checkSkipIfRunning", () => {
  it("returns null when skip_if_running is false", () => {
    const ctx = makeCtx({
      schedule: makeSchedule({ skip_if_running: false }),
      activeRunExists: true,
    });
    expect(checkSkipIfRunning(ctx)).toBeNull();
  });

  it("returns null when skip_if_running is true but no active run", () => {
    const ctx = makeCtx({
      schedule: makeSchedule({ skip_if_running: true }),
      activeRunExists: false,
    });
    expect(checkSkipIfRunning(ctx)).toBeNull();
  });

  it("returns reason when skip_if_running is true and active run exists", () => {
    const ctx = makeCtx({
      schedule: makeSchedule({ skip_if_running: true }),
      activeRunExists: true,
    });
    expect(checkSkipIfRunning(ctx)).toMatch(/active run/);
  });
});

describe("checkSkipIfRecent", () => {
  it("returns null when skip_if_recent_hours is null", () => {
    const ctx = makeCtx({ schedule: makeSchedule({ skip_if_recent_hours: null }) });
    expect(checkSkipIfRecent(ctx)).toBeNull();
  });

  it("returns null when no last completed run", () => {
    const ctx = makeCtx({
      schedule: makeSchedule({ skip_if_recent_hours: 2 }),
      lastCompletedRunAt: null,
    });
    expect(checkSkipIfRecent(ctx)).toBeNull();
  });

  it("returns null when last run is older than the cooldown window", () => {
    const now = new Date("2025-06-10T14:30:00Z");
    const lastRun = new Date("2025-06-10T11:00:00Z"); // 3.5h ago
    const ctx = makeCtx({
      schedule: makeSchedule({ skip_if_recent_hours: 2 }),
      now,
      lastCompletedRunAt: lastRun,
    });
    expect(checkSkipIfRecent(ctx)).toBeNull();
  });

  it("returns reason when last run is within the cooldown window", () => {
    const now = new Date("2025-06-10T14:30:00Z");
    const lastRun = new Date("2025-06-10T14:00:00Z"); // 30 min ago
    const ctx = makeCtx({
      schedule: makeSchedule({ skip_if_recent_hours: 2 }),
      now,
      lastCompletedRunAt: lastRun,
    });
    expect(checkSkipIfRecent(ctx)).toMatch(/last run too recent/);
  });
});

describe("checkQuietHours", () => {
  it("returns null when quiet hours are not configured", () => {
    const ctx = makeCtx({
      schedule: makeSchedule({ quiet_hours_start: null, quiet_hours_end: null }),
    });
    expect(checkQuietHours(ctx)).toBeNull();
  });

  it("returns null when current hour is outside the quiet window (10-18, hour 9)", () => {
    const ctx = makeCtx({
      schedule: makeSchedule({ quiet_hours_start: 10, quiet_hours_end: 18 }),
      now: new Date("2025-06-10T09:00:00Z"),
      userTimezone: "UTC",
    });
    expect(checkQuietHours(ctx)).toBeNull();
  });

  it("returns reason when current hour is inside the quiet window (10-18, hour 14)", () => {
    const ctx = makeCtx({
      schedule: makeSchedule({ quiet_hours_start: 10, quiet_hours_end: 18 }),
      now: new Date("2025-06-10T14:00:00Z"),
      userTimezone: "UTC",
    });
    expect(checkQuietHours(ctx)).toMatch(/quiet hours/);
  });

  it("handles wrap-around window (22-7): hour 23 is quiet", () => {
    const ctx = makeCtx({
      schedule: makeSchedule({ quiet_hours_start: 22, quiet_hours_end: 7 }),
      now: new Date("2025-06-10T23:00:00Z"),
      userTimezone: "UTC",
    });
    expect(checkQuietHours(ctx)).toMatch(/quiet hours/);
  });

  it("handles wrap-around window (22-7): hour 3 is quiet", () => {
    const ctx = makeCtx({
      schedule: makeSchedule({ quiet_hours_start: 22, quiet_hours_end: 7 }),
      now: new Date("2025-06-10T03:00:00Z"),
      userTimezone: "UTC",
    });
    expect(checkQuietHours(ctx)).toMatch(/quiet hours/);
  });

  it("handles wrap-around window (22-7): hour 10 is NOT quiet", () => {
    const ctx = makeCtx({
      schedule: makeSchedule({ quiet_hours_start: 22, quiet_hours_end: 7 }),
      now: new Date("2025-06-10T10:00:00Z"),
      userTimezone: "UTC",
    });
    expect(checkQuietHours(ctx)).toBeNull();
  });

  it("handles degenerate window (start === end): never quiet", () => {
    const ctx = makeCtx({
      schedule: makeSchedule({ quiet_hours_start: 9, quiet_hours_end: 9 }),
      now: new Date("2025-06-10T09:00:00Z"),
      userTimezone: "UTC",
    });
    expect(checkQuietHours(ctx)).toBeNull();
  });
});

describe("checkConditions (composite)", () => {
  it("returns null when all conditions pass", () => {
    const ctx = makeCtx();
    expect(checkConditions(ctx)).toBeNull();
  });

  it("skip_if_running fires before skip_if_recent", () => {
    const now = new Date("2025-06-10T14:30:00Z");
    const lastRun = new Date("2025-06-10T14:00:00Z"); // within cooldown
    const ctx = makeCtx({
      schedule: makeSchedule({ skip_if_running: true, skip_if_recent_hours: 2 }),
      now,
      activeRunExists: true,
      lastCompletedRunAt: lastRun,
    });
    const reason = checkConditions(ctx);
    expect(reason).toMatch(/active run/); // first match wins
  });

  it("skip_if_recent fires before quiet_hours", () => {
    const now = new Date("2025-06-10T14:30:00Z");
    const lastRun = new Date("2025-06-10T14:00:00Z");
    const ctx = makeCtx({
      schedule: makeSchedule({
        skip_if_running: false,
        skip_if_recent_hours: 2,
        quiet_hours_start: 10,
        quiet_hours_end: 18,
      }),
      now,
      lastCompletedRunAt: lastRun,
    });
    const reason = checkConditions(ctx);
    expect(reason).toMatch(/last run too recent/);
  });

  it("quiet_hours fires when it is the only matching condition", () => {
    const ctx = makeCtx({
      schedule: makeSchedule({ quiet_hours_start: 10, quiet_hours_end: 18 }),
      now: new Date("2025-06-10T14:00:00Z"),
      userTimezone: "UTC",
    });
    expect(checkConditions(ctx)).toMatch(/quiet hours/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// schedule-runner (mocked Supabase)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock of SchedulerSupabaseClient.
 *
 * Each chainable method returns `this` so we can fluently `.eq().lte()` etc.
 * The `then` property makes it a thenable so `await chain` resolves to the
 * configured result. The biome-ignore comments are required because Biome's
 * noThenProperty rule disallows `then` on plain objects; this is the same
 * pattern used in other tests across this codebase.
 */
function makeChain<T>(result: { data: T; error: unknown }) {
  const resolvedPromise = Promise.resolve(result);

  const chain = {
    // biome-ignore lint/suspicious/noThenProperty: required to satisfy DbChain thenable interface
    then: (onFulfilled: unknown, onRejected: unknown) =>
      resolvedPromise.then(
        onFulfilled as Parameters<typeof resolvedPromise.then>[0],
        onRejected as Parameters<typeof resolvedPromise.then>[1],
      ),
    catch: (onRejected: unknown) =>
      resolvedPromise.catch(onRejected as Parameters<typeof resolvedPromise.catch>[0]),
    finally: (onFinally: unknown) =>
      resolvedPromise.finally(onFinally as Parameters<typeof resolvedPromise.finally>[0]),
    eq() {
      return chain;
    },
    in() {
      return chain;
    },
    lte() {
      return chain;
    },
    select() {
      return chain;
    },
    limit() {
      return chain;
    },
    single: () => resolvedPromise,
  };

  return chain;
}

function makeMockSupabase(overrides: {
  schedules?: Schedule[];
  activeRuns?: unknown[];
  completedRuns?: unknown[];
  settings?: unknown[];
  rpcResult?: { data: string | null; error: unknown };
  updateError?: unknown;
}) {
  const schedules = overrides.schedules ?? [];
  const activeRuns = overrides.activeRuns ?? [];
  const completedRuns = overrides.completedRuns ?? [];
  const settings = overrides.settings ?? [{ timezone: "UTC" }];
  const rpcResult = overrides.rpcResult ?? { data: "run-new-1", error: null };
  const updateError = overrides.updateError ?? null;

  const updateChain = makeChain({ data: null, error: updateError });

  const fromImpl = (table: string) => {
    if (table === "schedules") {
      return {
        select: () => makeChain({ data: schedules, error: null }),
        update: () => updateChain,
        insert: () => makeChain({ data: null, error: null }),
      };
    }
    if (table === "runs") {
      // Return active or completed depending on whether `.eq("status","completed")`
      // was called. We track state on the chain object itself.
      let isCompleted = false;

      const runsChain = {
        // biome-ignore lint/suspicious/noThenProperty: required to satisfy DbArrayChain thenable interface
        then(onFulfilled: unknown, onRejected: unknown) {
          const data = isCompleted ? completedRuns : activeRuns;
          return Promise.resolve({ data, error: null }).then(
            onFulfilled as Parameters<Promise<unknown>["then"]>[0],
            onRejected as Parameters<Promise<unknown>["then"]>[1],
          );
        },
        catch(f: unknown) {
          return Promise.resolve({ data: [], error: null }).catch(
            f as Parameters<Promise<unknown>["catch"]>[0],
          );
        },
        finally(f: unknown) {
          return Promise.resolve({ data: [], error: null }).finally(
            f as Parameters<Promise<unknown>["finally"]>[0],
          );
        },
        eq(_col: string, val: unknown) {
          if (val === "completed") isCompleted = true;
          return runsChain;
        },
        in() {
          return runsChain;
        },
        lte() {
          return runsChain;
        },
        select() {
          return runsChain;
        },
        limit() {
          return runsChain;
        },
        single: () =>
          Promise.resolve({
            data: isCompleted ? (completedRuns[0] ?? null) : (activeRuns[0] ?? null),
            error: null,
          }),
      };
      return {
        select: () => runsChain,
        update: () => updateChain,
        insert: () => makeChain({ data: null, error: null }),
      };
    }
    if (table === "settings") {
      return {
        select: () => makeChain({ data: settings, error: null }),
        update: () => updateChain,
        insert: () => makeChain({ data: null, error: null }),
      };
    }
    return {
      select: () => makeChain({ data: [], error: null }),
      update: () => updateChain,
      insert: () => makeChain({ data: null, error: null }),
    };
  };

  return {
    from: vi.fn().mockImplementation(fromImpl),
    rpc: vi.fn().mockResolvedValue(rpcResult),
  };
}

function makeSilentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    // pino Logger has these additional methods — stub them out
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: "silent",
    silent: vi.fn(),
    bindings: vi.fn().mockReturnValue({}),
    flush: vi.fn(),
    isLevelEnabled: vi.fn().mockReturnValue(false),
  } as unknown as import("../logger.js").Logger;
}

describe("ScheduleRunner.tick", () => {
  it("returns zeros when there are no due schedules", async () => {
    const supabase = makeMockSupabase({ schedules: [] });
    const runner = new ScheduleRunner(supabase as never, makeSilentLogger());

    const result = await runner.tick();

    expect(result).toEqual({ processed: 0, enqueued: 0, skipped: 0, errors: 0 });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("enqueues a run and updates next_run_at for one due schedule", async () => {
    const schedule = makeSchedule({ cron_expression: "*/5 * * * *" });
    const supabase = makeMockSupabase({ schedules: [schedule] });
    const runner = new ScheduleRunner(supabase as never, makeSilentLogger());

    const result = await runner.tick();

    expect(result.processed).toBe(1);
    expect(result.enqueued).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(supabase.rpc).toHaveBeenCalledWith("enqueue_run", {
      p_plan_id: schedule.plan_id,
      p_user_id: schedule.user_id,
      p_triggered_by: "schedule",
      p_working_dir: schedule.working_dir,
    });
  });

  it("counts skipped when skip_if_running fires", async () => {
    const schedule = makeSchedule({ skip_if_running: true });
    const supabase = makeMockSupabase({
      schedules: [schedule],
      // Simulate an active run for the plan
      activeRuns: [{ id: "run-active", status: "running" }],
    });
    const runner = new ScheduleRunner(supabase as never, makeSilentLogger());

    const result = await runner.tick();

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.enqueued).toBe(0);
    // No run should have been enqueued
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("counts skipped when skip_if_recent_hours fires", async () => {
    const now = new Date();
    const recentRun = new Date(now.getTime() - 30 * 60 * 1000); // 30 min ago
    const schedule = makeSchedule({ skip_if_recent_hours: 2 });
    const supabase = makeMockSupabase({
      schedules: [schedule],
      completedRuns: [
        { id: "run-past", status: "completed", finished_at: recentRun.toISOString() },
      ],
    });
    const runner = new ScheduleRunner(supabase as never, makeSilentLogger());

    const result = await runner.tick();

    expect(result.skipped).toBe(1);
    expect(result.enqueued).toBe(0);
  });

  it("counts errors when the RPC fails", async () => {
    const schedule = makeSchedule();
    const supabase = makeMockSupabase({
      schedules: [schedule],
      rpcResult: { data: null, error: new Error("DB connection failed") },
    });
    const runner = new ScheduleRunner(supabase as never, makeSilentLogger());

    const result = await runner.tick();

    expect(result.processed).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.enqueued).toBe(0);
  });

  it("processes multiple schedules independently", async () => {
    const scheduleA = makeSchedule({ id: "sched-a", plan_id: "plan-a" });
    const scheduleB = makeSchedule({ id: "sched-b", plan_id: "plan-b" });
    const supabase = makeMockSupabase({ schedules: [scheduleA, scheduleB] });
    const runner = new ScheduleRunner(supabase as never, makeSilentLogger());

    const result = await runner.tick();

    expect(result.processed).toBe(2);
    expect(result.enqueued).toBe(2);
  });
});

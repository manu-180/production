/**
 * Conductor — Scheduler (barrel)
 *
 * Public surface for the cron-based schedule runner:
 *  - types:            ScheduleTickResult, ScheduleConditionContext, Schedule
 *  - cron-parser:      parseCron, isValidCron, getNextRun, CronExpression
 *  - conditions:       checkConditions (+ individual checkers)
 *  - schedule-runner:  ScheduleRunner
 */

export type { Schedule, ScheduleTickResult, ScheduleConditionContext } from "./types.js";

export type { CronExpression } from "./cron-parser.js";
export { parseCron, isValidCron, getNextRun } from "./cron-parser.js";

export {
  checkConditions,
  checkSkipIfRunning,
  checkSkipIfRecent,
  checkQuietHours,
} from "./conditions.js";

export type {
  SchedulerSupabaseClient,
  SchedulerDbVoidResult,
  SchedulerDbSingleResult,
  SchedulerDbArrayResult,
} from "./schedule-runner.js";
export { ScheduleRunner } from "./schedule-runner.js";

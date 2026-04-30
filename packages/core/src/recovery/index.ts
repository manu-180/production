/**
 * Conductor — Recovery (barrel)
 *
 * Public surface for phase 09 recovery primitives:
 *  - error-classifier: ExecutorError -> recovery category + retry decision
 *  - retry-policy:     pure backoff strategies (fixed / exp / exp-jitter)
 *  - circuit-breaker:  consecutive-failure breaker with half-open trial
 *  - rate-limit-handler: per-prompt rate-limit cap + Retry-After parser
 *  - health-monitor:   per-run heartbeat publisher
 *  - crash-recovery:   sweep orphaned `runs` rows after worker crash
 *  - resumability:     compute resume point + flip run status helpers
 */

export {
  type ClassifiedError,
  type ErrorCategory,
  classifyError,
  extractRetryAfterMs,
} from "./error-classifier.js";

export {
  type BackoffStrategy,
  type RetryPolicy as RecoveryRetryPolicy,
  type RandomFn,
  DEFAULT_RETRY_POLICY,
  nextDelay,
} from "./retry-policy.js";

export {
  type CircuitState,
  type CircuitBreakerOptions,
  CircuitBreaker,
} from "./circuit-breaker.js";

export {
  type RateLimitTrackerOptions,
  RateLimitTracker,
  parseRetryAfter,
} from "./rate-limit-handler.js";

export {
  type HealthMonitorLogger,
  type HealthMonitorOptions,
  HealthMonitor,
} from "./health-monitor.js";

export {
  type CrashRecoveryLogger,
  type RecoveryDbClient,
  type RecoveryDbTable,
  type RecoveryDbSelect,
  type RecoveryDbUpdate,
  type RecoveryDbResult,
  type RecoveryRunRow,
  type RecoverOrphanedOptions,
  type RecoverOrphanedResult,
  recoverOrphanedRuns,
} from "./crash-recovery.js";

export {
  type ResumabilityLogger,
  type ResumeDbClient,
  type ResumeDbTable,
  type ResumeDbSelect,
  type ResumeDbUpdate,
  type ResumeDbResult,
  type ResumableRun,
  type ResumableExecution,
  type ResumableState,
  loadResumableState,
  markRunResumable,
  resumeRun,
} from "./resumability.js";

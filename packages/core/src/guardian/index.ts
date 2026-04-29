/**
 * Conductor — Guardian module barrel.
 *
 * Re-exports the public surface of the Guardian phase: question detection,
 * decision engine, system-prompt injection, and the high-level runner that
 * stitches them together for the orchestrator.
 */
export { QuestionDetector } from "./question-detector.js";
export type { DetectionInput, DetectionResult } from "./question-detector.js";

export { DecisionEngine } from "./decision-engine.js";
export type {
  DecisionInput,
  DecisionResult,
  DecisionStrategy,
} from "./decision-engine.js";

export { SystemPromptInjector } from "./system-prompt-injector.js";
export type { InjectionResult } from "./system-prompt-injector.js";

export { GuardianRunner } from "./guardian-runner.js";
export type {
  GuardianCheckParams,
  GuardianInterventionResult,
  GuardianMode,
  GuardianRunnerConfig,
} from "./guardian-runner.js";

export { GuardianAuditLog } from "./audit-log.js";
export type {
  AuditLogResult,
  DbClient as GuardianDbClient,
  DbTable as GuardianDbTable,
  GuardianDecisionRecord,
  GuardianDecisionRow,
  GuardianMetrics,
} from "./audit-log.js";

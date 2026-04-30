/**
 * Conductor — Checkpoint barrel
 *
 * Re-exports the public surface of the checkpoint subsystem. The concrete
 * `CheckpointManager` class is exported under an alias so it does NOT collide
 * with the structural `CheckpointManager` interface declared by the
 * orchestrator (which describes the abstract contract the orchestrator
 * depends on).
 */

export * from "./git-manager.js";
export * from "./safety-guards.js";
export * from "./repo-initializer.js";
export * from "./commit-message-formatter.js";
export * from "./diff-extractor.js";
export {
  CheckpointManager as ConcreteCheckpointManager,
  CheckpointManagerError,
  type PromptMetadata,
  type CheckpointEntry,
  type RunInitResult,
} from "./checkpoint-manager.js";

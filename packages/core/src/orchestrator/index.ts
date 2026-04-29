/**
 * Conductor — Orchestrator barrel
 *
 * Re-exports every public surface of the orchestrator subsystem so consumers
 * can `import { Orchestrator, parsePrompt, ... } from "@conductor/core/orchestrator"`.
 *
 * `SupabaseLikeClient` is defined locally in both `progress-emitter.ts` and
 * `plan-loader.ts` with different shapes (each module describes only the
 * surface it actually uses). We re-export the progress-emitter variant under
 * its canonical name and rename the plan-loader variant to avoid an ambiguous
 * re-export.
 */

export * from "./frontmatter-schema.js";
export * from "./prompt-parser.js";
export { loadPlanFromDb, loadPlanFromDir, loadPlanFromUploaded } from "./plan-loader.js";
export type {
  UploadedFile,
  SupabaseLikeClient as PlanLoaderSupabaseClient,
} from "./plan-loader.js";
export * from "./execution-context.js";
export * from "./pause-controller.js";
export * from "./progress-emitter.js";
export * from "./orchestrator.js";

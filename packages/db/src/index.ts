import type { Database } from "./types.gen";

export { createClient } from "./client";
export { createServerComponentClient, createServiceClient } from "./server";
export type { Database } from "./types.gen";
export type { Json } from "./types.gen";

// ─── Table Row aliases ────────────────────────────────────────────────────────
export type AuthToken = Database["public"]["Tables"]["auth_tokens"]["Row"];
export type AuthTokenInsert = Database["public"]["Tables"]["auth_tokens"]["Insert"];

export type Plan = Database["public"]["Tables"]["plans"]["Row"];
export type PlanInsert = Database["public"]["Tables"]["plans"]["Insert"];
export type PlanUpdate = Database["public"]["Tables"]["plans"]["Update"];

export type Prompt = Database["public"]["Tables"]["prompts"]["Row"];
export type PromptInsert = Database["public"]["Tables"]["prompts"]["Insert"];
export type PromptUpdate = Database["public"]["Tables"]["prompts"]["Update"];

export type Run = Database["public"]["Tables"]["runs"]["Row"];
export type RunInsert = Database["public"]["Tables"]["runs"]["Insert"];
export type RunUpdate = Database["public"]["Tables"]["runs"]["Update"];

export type PromptExecution = Database["public"]["Tables"]["prompt_executions"]["Row"];
export type PromptExecutionInsert = Database["public"]["Tables"]["prompt_executions"]["Insert"];
export type PromptExecutionUpdate = Database["public"]["Tables"]["prompt_executions"]["Update"];

export type RunEvent = Database["public"]["Tables"]["run_events"]["Row"];
export type RunEventInsert = Database["public"]["Tables"]["run_events"]["Insert"];

export type GuardianDecision = Database["public"]["Tables"]["guardian_decisions"]["Row"];
export type GuardianDecisionInsert = Database["public"]["Tables"]["guardian_decisions"]["Insert"];

export type OutputChunk = Database["public"]["Tables"]["output_chunks"]["Row"];
export type OutputChunkInsert = Database["public"]["Tables"]["output_chunks"]["Insert"];

export type Settings = Database["public"]["Tables"]["settings"]["Row"];
export type SettingsUpdate = Database["public"]["Tables"]["settings"]["Update"];

// ─── Run status literals ──────────────────────────────────────────────────────
export type RunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

export type ExecutionStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "rolled_back"
  | "awaiting_approval";

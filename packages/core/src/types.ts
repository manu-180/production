/**
 * Conductor — Type Contracts
 * Canonical source of truth for all TypeScript interfaces across the system.
 * No imports, no implementation — types only.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Plan & Prompts
// ─────────────────────────────────────────────────────────────────────────────

export interface Plan {
  id: string;
  name: string;
  description?: string;
  prompts: PromptDefinition[];
  defaultWorkingDir?: string;
  createdAt: string;
}

export interface PromptDefinition {
  id: string;
  order: number;
  filename: string;
  content: string;
  frontmatter: PromptFrontmatter;
}

export interface PromptFrontmatter {
  title?: string;
  continueSession?: boolean;
  allowedTools?: string[];
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  maxTurns?: number;
  maxBudgetUsd?: number;
  timeoutMs?: number;
  retries?: number;
  requiresApproval?: boolean;
  rollbackOnFail?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runs & Executions
// ─────────────────────────────────────────────────────────────────────────────

export interface Run {
  id: string;
  planId: string;
  workingDir: string;
  status: RunStatus;
  startedAt?: string;
  finishedAt?: string;
  currentPromptIndex?: number;
  runBranch: string;
  totalCostUsd: number;
  totalTokens: TokenUsage;
}

export type RunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface PromptExecution {
  id: string;
  runId: string;
  promptId: string;
  status: PromptExecutionStatus;
  attempt: number;
  startedAt?: string;
  finishedAt?: string;
  sessionId?: string;
  checkpointSha?: string;
  costUsd: number;
  tokens: TokenUsage;
  error?: ExecutionError;
}

export type PromptExecutionStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "rolled_back";

export interface ExecutionError {
  code: "TIMEOUT" | "NON_ZERO_EXIT" | "PARSE_ERROR" | "AUTH_FAILED" | "GUARDIAN_FAILED" | "UNKNOWN";
  message: string;
  raw?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Usage
// ─────────────────────────────────────────────────────────────────────────────

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardian
// ─────────────────────────────────────────────────────────────────────────────

export interface GuardianDecision {
  id: string;
  promptExecutionId: string;
  questionDetected: string;
  reasoning: string;
  decision: string;
  confidence: number;
  strategy: GuardianStrategy;
  decidedAt: string;
  reviewedByHuman?: boolean;
}

export type GuardianStrategy = "heuristic" | "llm";

// ─────────────────────────────────────────────────────────────────────────────
// Streaming Events
// ─────────────────────────────────────────────────────────────────────────────

export type RunEvent =
  | { type: "run.started"; runId: string }
  | { type: "prompt.started"; promptId: string; index: number; total: number }
  | {
      type: "prompt.output";
      promptId: string;
      chunk: string;
      channel: "stdout" | "stderr";
    }
  | { type: "prompt.tool_use"; promptId: string; tool: string; input: unknown }
  | {
      type: "prompt.tool_result";
      promptId: string;
      tool: string;
      output: unknown;
    }
  | { type: "prompt.guardian_intervention"; decision: GuardianDecision }
  | { type: "prompt.checkpoint_created"; promptId: string; sha: string }
  | {
      type: "prompt.completed";
      promptId: string;
      tokens: TokenUsage;
      costUsd: number;
    }
  | {
      type: "prompt.failed";
      promptId: string;
      error: string;
      willRetry: boolean;
    }
  | { type: "run.paused"; reason: string }
  | { type: "run.completed"; totalCostUsd: number; durationMs: number }
  | { type: "run.failed"; failedAtPromptId: string; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutorConfig {
  claudeBinary: string;
  outputFormat: "stream-json" | "json" | "text";
  permissionMode: NonNullable<PromptFrontmatter["permissionMode"]>;
  allowedTools: string[];
  appendSystemPrompt?: string;
  maxTurns?: number;
  timeoutMs?: number;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  maxBackoffMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// View Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanSummary {
  id: string;
  name: string;
  description?: string;
  promptCount: number;
  createdAt: string;
}

export interface RunWithExecutions extends Run {
  executions: PromptExecution[];
}

export interface RunSnapshot {
  run: Run;
  currentExecution?: PromptExecution;
  lastEvent?: RunEvent;
}

# Conductor — Type Contracts

This document is the API reference for every TypeScript interface that crosses
module boundaries inside Conductor. Anything serialized to disk, sent over the
event bus, or persisted in Supabase has its shape defined here.

The canonical, compilable source is
[`contracts.ts`](./contracts.ts) — this Markdown is its annotated mirror.

---

## Plan & Prompts

### `Plan`

A Plan is the top-level orchestration unit. It is an ordered list of prompts
that Conductor will execute sequentially against a single working directory.

```typescript
export interface Plan {
  id: string;
  name: string;
  description?: string;
  prompts: PromptDefinition[];
  defaultWorkingDir?: string;
  createdAt: Date;
}
```

### `PromptDefinition`

A single prompt within a Plan, parsed from a Markdown file with YAML
frontmatter. `order` determines its position in the execution sequence.

```typescript
export interface PromptDefinition {
  id: string;
  order: number;
  filename: string;
  content: string;
  frontmatter: PromptFrontmatter;
}
```

### `PromptFrontmatter`

The YAML frontmatter declared at the top of each prompt file. It controls the
per-prompt execution policy: whether to reuse the previous Claude session,
which tools are allowed, budget caps, retries, and rollback behavior.

```typescript
export interface PromptFrontmatter {
  title?: string;
  continueSession?: boolean;        // default false: each prompt starts a new session
  allowedTools?: string[];
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
  maxTurns?: number;
  maxBudgetUsd?: number;
  timeoutMs?: number;
  retries?: number;                 // default 2
  requiresApproval?: boolean;       // pause point before execution
  rollbackOnFail?: boolean;         // default true
}
```

---

## Runs & Executions

### `Run`

A Run is a single end-to-end execution of a Plan. It owns the working
directory, the dedicated git checkpoint branch, and aggregate cost / token
totals for the whole sequence.

```typescript
export interface Run {
  id: string;
  planId: string;
  workingDir: string;
  status: RunStatus;
  startedAt?: string;
  finishedAt?: string;
  currentPromptIndex?: number;
  runBranch: string;                // git branch for this run: conductor/run-{runId}
  totalCostUsd: number;
  totalTokens: TokenUsage;
}
```

### `RunStatus`

The lifecycle states a Run can be in.

```typescript
export type RunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
```

### `PromptExecution`

The per-prompt attempt record inside a Run. It captures the Claude session id
(used for `--resume`), the post-success git SHA, cost, token usage, and any
error encountered.

```typescript
export interface PromptExecution {
  id: string;
  runId: string;
  promptId: string;
  status: PromptExecutionStatus;
  attempt: number;
  startedAt?: Date;
  finishedAt?: Date;
  sessionId?: string;               // Claude session id for --resume
  checkpointSha?: string;           // git commit hash after success
  costUsd: number;
  tokens: TokenUsage;
  error?: ExecutionError;
}
```

### `PromptExecutionStatus`

The lifecycle states of a single PromptExecution attempt.

```typescript
export type PromptExecutionStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'rolled_back';
```

### `ExecutionError`

The structured error attached to a failed PromptExecution. The `raw` field
preserves the original stderr / exception text so the dashboard can render it
verbatim during debugging.

```typescript
export interface ExecutionError {
  code: string;
  message: string;
  raw?: string;
}
```

---

## Guardian

### `GuardianDecision`

The persisted record of an autonomous decision made by the Guardian agent
whenever Claude paused on an ambiguous question. Stored for audit, replay,
and optional human review.

```typescript
export interface GuardianDecision {
  id: string;
  promptExecutionId: string;
  questionDetected: string;
  reasoning: string;
  decision: string;
  confidence: number;               // 0-1
  strategy: GuardianStrategy;       // which tier produced this decision
  decidedAt: string;
  reviewedByHuman?: boolean;
}
```

### `GuardianStrategy`

The strategy used by the Guardian to resolve an ambiguous question. The
`combined` mode tries heuristics first and only escalates to an LLM when the
confidence threshold is not met.

```typescript
export type GuardianStrategy = 'heuristic' | 'llm' | 'combined';
```

---

## Events (Streaming)

### `RunEvent`

A discriminated union of every event emitted by the Executor and forwarded
through the event bus (Server-Sent Events / Supabase Realtime) to the
dashboard. Every variant carries enough payload that consumers can switch on
`type` without needing to fetch additional state.

```typescript
export type RunEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'prompt.started'; promptId: string; index: number; total: number }
  | { type: 'prompt.output'; promptId: string; chunk: string; channel: 'stdout' | 'stderr' }
  | { type: 'prompt.tool_use'; promptId: string; tool: string; input: unknown }
  | { type: 'prompt.tool_result'; promptId: string; tool: string; output: unknown }
  | { type: 'prompt.guardian_intervention'; decision: GuardianDecision }
  | { type: 'prompt.checkpoint_created'; promptId: string; sha: string }
  | { type: 'prompt.completed'; promptId: string; tokens: TokenUsage; costUsd: number }
  | { type: 'prompt.failed'; promptId: string; error: string; willRetry: boolean }
  | { type: 'run.paused'; reason: string }
  | { type: 'run.completed'; totalCostUsd: number; durationMs: number }
  | { type: 'run.failed'; failedAtPromptId: string; error: string };
```

---

## Token Usage

### `TokenUsage`

Token accounting for a single prompt execution or aggregated across an entire
run. Anthropic billing distinguishes cache reads (cheaper) from cache creation
(more expensive), so they are tracked separately.

```typescript
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;                // tokens served from cache (cheaper)
  cacheCreation: number;            // tokens written to cache (more expensive)
}
```

---

## Configuration

### `ExecutorConfig`

The configuration passed to the Executor when it spawns the Claude CLI. Each
field maps one-to-one to a supported `claude -p` flag.

```typescript
export interface ExecutorConfig {
  claudeBinary: string;             // path to claude CLI binary
  outputFormat: 'stream-json' | 'json' | 'text';
  permissionMode: PromptFrontmatter['permissionMode'];
  allowedTools: string[];
  appendSystemPrompt?: string;
  maxTurns?: number;
  timeoutMs?: number;
}
```

### `RetryPolicy`

The retry policy applied to failed PromptExecutions. Backoff starts at
`backoffMs` and doubles on each attempt up to `maxBackoffMs`.

```typescript
export interface RetryPolicy {
  maxAttempts: number;              // default 3 (1 initial + 2 retries)
  backoffMs: number;                // initial backoff, doubles each attempt
  maxBackoffMs: number;
}
```

---

## Utility Types — Views & Composites

These types are derived projections of the core entities, designed for
specific UI surfaces. They are not stored as separate records; they are
assembled at read time.

### `PlanSummary`

A lightweight projection of `Plan` for list views in the dashboard. It drops
the heavy `prompts[]` payload and replaces it with a `promptCount`.

```typescript
export interface PlanSummary {
  id: string;
  name: string;
  description?: string;
  promptCount: number;
  createdAt: Date;
}
```

### `RunWithExecutions`

The detail view: a `Run` joined with the full ordered list of its
`PromptExecution` records. Used by the dashboard's run-detail screen and the
JSON export endpoint.

```typescript
export interface RunWithExecutions extends Run {
  executions: PromptExecution[];
}
```

### `RunSnapshot`

A snapshot of a Run plus its most recent event, used by the live dashboard's
"current activity" panel. Decoupled from the event log so the consumer never
has to replay history just to render the latest state.

```typescript
export interface RunSnapshot {
  run: Run;
  currentExecution?: PromptExecution;
  lastEvent?: RunEvent;
}
```

/**
 * Conductor — Prompt Frontmatter Schema
 *
 * Zod schema describing the YAML frontmatter that may appear at the top of
 * each `.md` prompt file consumed by the orchestrator.
 *
 * All fields are optional in user input; defaults are applied during parsing
 * so downstream code can rely on a fully populated `ParsedFrontmatter` shape.
 */

import { z } from "zod";

const PromptFrontmatterSchema = z.object({
  /** Human-readable title; if omitted, parser derives one from the filename. */
  title: z.string().optional(),

  /** Whether to resume the previous Claude session instead of starting fresh. */
  continueSession: z.boolean().default(false),

  /** Tools the executor is allowed to invoke for this prompt. */
  allowedTools: z.array(z.string()).default(() => ["Edit", "Write", "Read", "Bash"]),

  /** Permission mode for tool calls. */
  permissionMode: z
    .enum(["default", "acceptEdits", "bypassPermissions"])
    .default("bypassPermissions"),

  /** Maximum agent turns before the executor stops the prompt. */
  maxTurns: z.number().int().positive().default(50),

  /** Optional hard cap on USD spend for this prompt. */
  maxBudgetUsd: z.number().positive().optional(),

  /** Wall-clock timeout in milliseconds (default: 10 minutes). */
  timeoutMs: z.number().int().positive().default(600_000),

  idleTimeoutMs: z.number().int().positive().optional(),

  /** Number of automatic retries on transient failure (0–10). Undefined → orchestrator uses DEFAULT_PROMPT_RETRIES. */
  retries: z.number().int().min(0).max(10).optional(),

  /** If true, the run pauses for human approval before executing this prompt. */
  requiresApproval: z.boolean().default(false),

  /** If true, a failure triggers a git rollback to the previous checkpoint. */
  rollbackOnFail: z.boolean().default(false),

  /** Free-form labels for filtering / grouping. */
  tags: z.array(z.string()).default(() => []),

  /** Filenames or ids this prompt depends on (must complete first). */
  dependsOn: z.array(z.string()).default(() => []),
});

/** Fully-resolved frontmatter (defaults applied) inferred from the schema. */
type ParsedFrontmatter = z.infer<typeof PromptFrontmatterSchema>;

export { PromptFrontmatterSchema };
export type { ParsedFrontmatter };

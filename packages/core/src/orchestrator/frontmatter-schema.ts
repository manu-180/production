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

  /**
   * Whether the Guardian runs for this prompt. Defaults to `true`. Set to
   * `false` for mechanical prompts (renames, simple component scaffolds,
   * formatting passes) where the Guardian's detect+decide cycle per turn is
   * pure overhead. The orchestrator skips guideline injection AND the
   * post-turn intervention check when this is false.
   */
  guardian: z.boolean().default(true),

  /**
   * Whether to resume the previous Claude session instead of starting fresh.
   * Defaults to `true` so sequential prompts in a plan reuse the previous
   * session's prompt cache and tool-call context (huge token savings for
   * multi-step plans operating on the same codebase). Parallel waves
   * automatically strip the resume id (siblings cannot share a session),
   * and the first prompt naturally has no prior session to resume from,
   * so the default is safe in both cases.
   */
  continueSession: z.boolean().default(true),

  /** Tools the executor is allowed to invoke for this prompt. */
  allowedTools: z.array(z.string()).default(() => ["Edit", "Write", "Read", "Bash"]),

  /** Permission mode for tool calls. */
  permissionMode: z
    .enum(["default", "acceptEdits", "bypassPermissions"])
    .default("bypassPermissions"),

  /**
   * Maximum agent turns before the executor stops the prompt. Default lowered
   * to 20 (from 50) to discipline prompt size and cut tail-expensive runs that
   * loop without converging. Prompts that genuinely need more should set it
   * explicitly in their frontmatter.
   */
  maxTurns: z.number().int().positive().default(20),

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

  /**
   * Optional wave override. Prompts sharing a wave number run in parallel
   * (capped concurrency); waves themselves execute sequentially in ascending
   * order. When omitted, the loader derives the wave from the filename's
   * numeric prefix (e.g., `03a-foo.md` → 3) or assigns a unique sequential
   * wave to keep behavior backward-compatible.
   */
  wave: z.number().int().nonnegative().optional(),
});

/** Fully-resolved frontmatter (defaults applied) inferred from the schema. */
type ParsedFrontmatter = z.infer<typeof PromptFrontmatterSchema>;

export { PromptFrontmatterSchema };
export type { ParsedFrontmatter };

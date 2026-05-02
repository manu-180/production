/**
 * Conductor — Plan Loader
 *
 * Loads a {@link Plan} (an ordered collection of prompt definitions) from one
 * of three sources:
 *
 *   1. A directory of `.md` files on disk ({@link loadPlanFromDir}).
 *   2. An in-memory list of `{ name, content }` pairs, e.g. uploaded via the
 *      web UI ({@link loadPlanFromUploaded}).
 *   3. A persisted plan stored in Supabase ({@link loadPlanFromDb}).
 *
 * In every case we delegate frontmatter / body parsing to
 * {@link parsePromptFile} so the same validation, defaults, and warning
 * collection apply uniformly. Skip rules (README files, underscore-prefixed
 * drafts, non-`.md` extensions) are also shared between the disk and uploaded
 * paths.
 */

import { randomUUID } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Plan, PromptDefinition, PromptFrontmatter } from "../types.js";
import { type ParsedPrompt, parsePromptFile } from "./prompt-parser.js";

// ─────────────────────────────────────────────────────────────────────────────
// Supabase client surface (structural typing — no @supabase/* dependency)
// ─────────────────────────────────────────────────────────────────────────────

interface SupabaseQueryResult {
  data: unknown[] | null;
  error: unknown;
}

/** Minimal "thenable" select chain that may also expose `.order(...)`. */
interface SupabaseSelectChain extends PromiseLike<SupabaseQueryResult> {
  eq(col: string, val: string): SupabaseEqChain;
}

interface SupabaseEqChain extends PromiseLike<SupabaseQueryResult> {
  order?(col: string, opts?: { ascending?: boolean }): PromiseLike<SupabaseQueryResult>;
}

interface SupabaseLikeClient {
  from(table: string): {
    select(cols: string): SupabaseSelectChain;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decide whether a filename should participate in the plan. We skip:
 *   - Anything not ending in `.md` (case-insensitive).
 *   - README files (any case) — usually documentation, not prompts.
 *   - Files starting with `_` — convention for drafts / disabled prompts.
 */
function shouldIncludeFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".md")) return false;
  if (lower.startsWith("readme")) return false;
  if (filename.startsWith("_")) return false;
  return true;
}

/**
 * Project a {@link ParsedPrompt} into the orchestrator-facing
 * {@link PromptDefinition}. Strips parser-internal extras (`tags`,
 * `dependsOn`) so what we hand to the executor matches the public contract
 * declared in `types.ts`.
 */
function toPromptDefinition(parsed: ParsedPrompt, order: number): PromptDefinition {
  // Pull only the keys that belong to PromptFrontmatter — `tags` and
  // `dependsOn` live on ParsedFrontmatter for orchestrator use but aren't
  // part of the public PromptFrontmatter contract.
  const {
    title,
    continueSession,
    allowedTools,
    permissionMode,
    maxTurns,
    maxBudgetUsd,
    timeoutMs,
    retries,
    requiresApproval,
    rollbackOnFail,
  } = parsed.frontmatter;

  const frontmatter: PromptFrontmatter = {
    title,
    continueSession,
    allowedTools,
    permissionMode,
    maxTurns,
    maxBudgetUsd,
    timeoutMs,
    retries,
    requiresApproval,
    rollbackOnFail,
  };

  return {
    id: randomUUID(),
    order,
    filename: parsed.filename,
    content: parsed.content,
    frontmatter,
  };
}

/** Forward parser warnings to stderr with a stable, greppable prefix. */
function emitWarnings(filename: string, warnings: readonly string[]): void {
  for (const w of warnings) {
    console.warn(`[plan-loader] ${filename}: ${w}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 1 — filesystem directory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load a plan from a directory of `.md` files.
 *
 * Files are sorted lexicographically by name so a numeric prefix convention
 * (`00-`, `01-`, …) yields the natural execution order. Skipped files are
 * silently ignored; per-file parser warnings are echoed to stderr.
 *
 * @throws if `dir` does not exist or is not a directory.
 */
async function loadPlanFromDir(dir: string): Promise<Plan> {
  let dirStat: Awaited<ReturnType<typeof stat>>;
  try {
    dirStat = await stat(dir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read plan directory '${dir}': ${message}`);
  }
  if (!dirStat.isDirectory()) {
    throw new Error(`Plan path '${dir}' is not a directory`);
  }

  const entries = await readdir(dir);
  const filenames = entries
    .filter(shouldIncludeFile)
    // Locale-independent lexicographic sort so order is stable across OSes.
    .sort();

  const prompts: PromptDefinition[] = [];
  for (let i = 0; i < filenames.length; i++) {
    const filename = filenames[i];
    if (filename === undefined) continue; // satisfy noUncheckedIndexedAccess
    const fullPath = join(dir, filename);
    const rawContent = await readFile(fullPath, "utf8");
    const parsed = parsePromptFile(filename, rawContent);
    emitWarnings(filename, parsed.warnings);
    prompts.push(toPromptDefinition(parsed, i));
  }

  return {
    id: randomUUID(),
    name: basename(dir),
    prompts,
    createdAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 2 — in-memory uploaded files
// ─────────────────────────────────────────────────────────────────────────────

interface UploadedFile {
  name: string;
  content: string;
}

/**
 * Load a plan from in-memory file payloads (e.g. an upload from the web UI).
 *
 * Applies the same skip rules and ordering as {@link loadPlanFromDir} so the
 * two entry points produce equivalent plans for equivalent inputs.
 */
async function loadPlanFromUploaded(files: UploadedFile[]): Promise<Plan> {
  // Copy before sorting so we don't mutate the caller's array.
  const sorted = [...files]
    .filter((f) => shouldIncludeFile(f.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const prompts: PromptDefinition[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const file = sorted[i];
    if (file === undefined) continue;
    const parsed = parsePromptFile(file.name, file.content);
    emitWarnings(file.name, parsed.warnings);
    prompts.push(toPromptDefinition(parsed, i));
  }

  return {
    id: randomUUID(),
    name: "uploaded-plan",
    prompts,
    createdAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 3 — Supabase
// ─────────────────────────────────────────────────────────────────────────────

/** Shape of a row in the `plans` table (loose — we only access known keys). */
interface PlanRow {
  id: string;
  name: string;
  description?: string | null;
  default_working_dir?: string | null;
  created_at: string;
}

/** Shape of a row in the `prompts` table. */
interface PromptRow {
  id: string;
  plan_id: string;
  order_index: number;
  filename: string | null;
  content: string;
  frontmatter: PromptFrontmatter | null;
}

function isPlanRow(value: unknown): value is PlanRow {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["id"] === "string" &&
    typeof v["name"] === "string" &&
    typeof v["created_at"] === "string"
  );
}

function isPromptRow(value: unknown): value is PromptRow {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const fm = v["frontmatter"];
  if (fm !== null && fm !== undefined && typeof fm !== "object") return false;
  return (
    typeof v["id"] === "string" &&
    typeof v["plan_id"] === "string" &&
    typeof v["order_index"] === "number" &&
    (v["filename"] === null || typeof v["filename"] === "string") &&
    typeof v["content"] === "string"
  );
}

/**
 * Load a previously-persisted plan from Supabase.
 *
 * The `db` parameter is structurally typed against the subset of the
 * Supabase JS client we actually use, so test doubles can be passed without
 * pulling in `@supabase/supabase-js`.
 *
 * If the underlying client supports `.order(...)` on the prompts query we
 * use it; otherwise we sort by `order_index` in JS as a fallback.
 *
 * @throws if either query returns an error, or if the plan is not found.
 */
async function loadPlanFromDb(planId: string, db: SupabaseLikeClient): Promise<Plan> {
  const planResult = await db.from("plans").select("*").eq("id", planId);
  if (planResult.error) {
    throw new Error(`Failed to load plan '${planId}': ${formatDbError(planResult.error)}`);
  }
  const planRows = planResult.data ?? [];
  const planRow = planRows[0];
  if (!isPlanRow(planRow)) {
    throw new Error(`Plan '${planId}' not found`);
  }

  const promptsEqChain = db.from("prompts").select("*").eq("plan_id", planId);

  const promptsResult: SupabaseQueryResult =
    typeof promptsEqChain.order === "function"
      ? await promptsEqChain.order("order_index", { ascending: true })
      : await promptsEqChain;

  if (promptsResult.error) {
    throw new Error(
      `Failed to load prompts for plan '${planId}': ${formatDbError(promptsResult.error)}`,
    );
  }

  const promptRows = (promptsResult.data ?? []).filter(isPromptRow);
  // Defensive sort in case the server didn't apply ordering (e.g. fallback path).
  promptRows.sort((a, b) => a.order_index - b.order_index);

  const prompts: PromptDefinition[] = promptRows.map((row, idx) => {
    const fm = (row.frontmatter ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      order: idx,
      filename: row.filename,
      content: row.content,
      frontmatter: {
        title: fm["title"] as string | undefined,
        continueSession: fm["continueSession"] as boolean | undefined,
        allowedTools: fm["allowedTools"] as string[] | undefined,
        permissionMode: fm["permissionMode"] as
          | "default"
          | "acceptEdits"
          | "bypassPermissions"
          | undefined,
        maxTurns: fm["maxTurns"] as number | undefined,
        maxBudgetUsd: fm["maxBudgetUsd"] as number | undefined,
        timeoutMs: fm["timeoutMs"] as number | undefined,
        retries: fm["retries"] as number | undefined,
        requiresApproval: fm["requiresApproval"] as boolean | undefined,
        rollbackOnFail: fm["rollbackOnFail"] as boolean | undefined,
      },
    };
  });

  return {
    id: planRow.id,
    name: planRow.name,
    description: planRow.description ?? undefined,
    prompts,
    defaultWorkingDir: planRow.default_working_dir ?? undefined,
    createdAt: planRow.created_at,
  };
}

function formatDbError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(err);
}

export { loadPlanFromDb, loadPlanFromDir, loadPlanFromUploaded };
export type { SupabaseLikeClient, UploadedFile };

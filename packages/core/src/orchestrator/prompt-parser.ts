/**
 * Conductor — Prompt File Parser
 *
 * Parses a single `.md` prompt file (string content) into a structured
 * {@link ParsedPrompt}. Splits YAML frontmatter from the body via gray-matter,
 * validates the frontmatter against {@link PromptFrontmatterSchema}, and
 * collects non-fatal warnings (unknown keys, validation issues).
 *
 * Parsing never throws on bad frontmatter — it falls back to schema defaults
 * and surfaces problems through `warnings`. This keeps the orchestrator
 * resilient when authors hand-edit prompt files.
 */

import { createHash } from "node:crypto";
import matter from "gray-matter";
import { type ParsedFrontmatter, PromptFrontmatterSchema } from "./frontmatter-schema.js";

interface ParsedPrompt {
  /** Source filename, e.g. "01-setup.md". */
  filename: string;
  /** Title from frontmatter, or derived from the filename. */
  title: string;
  /** Body content with frontmatter stripped. */
  content: string;
  /** Original full file content (frontmatter + body). */
  rawContent: string;
  /** SHA-256 hex digest of `content` (body only — stable across frontmatter edits). */
  contentHash: string;
  /** Validated, defaults-applied frontmatter. */
  frontmatter: ParsedFrontmatter;
  /** Non-fatal issues encountered during parsing (unknown keys, validation errors). */
  warnings: string[];
}

/** Schema keys, computed once for unknown-key detection. */
const KNOWN_FRONTMATTER_KEYS: ReadonlySet<string> = new Set(
  Object.keys(PromptFrontmatterSchema.shape),
);

/**
 * Strip the leading order prefix (e.g. "01-") and `.md` extension from a
 * filename, then title-case the remaining hyphen/underscore-separated tokens.
 *
 * Examples:
 *   "01-setup-db.md"     → "Setup Db"
 *   "10_run_migration.md" → "Run Migration"
 *   "intro.md"            → "Intro"
 */
function deriveTitleFromFilename(filename: string): string {
  // Drop directory portion if any was passed by mistake.
  const base = filename.replace(/^.*[\\/]/, "");
  // Drop trailing extension.
  const noExt = base.replace(/\.[^.]+$/, "");
  // Strip leading numeric order prefix like "01-", "001_", "12-".
  const noPrefix = noExt.replace(/^\d+[-_]/, "");
  // Split on hyphen/underscore/whitespace, drop empties, title-case each token.
  const tokens = noPrefix.split(/[-_\s]+/).filter(Boolean);
  if (tokens.length === 0) return noExt || filename;
  return tokens.map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()).join(" ");
}

/** Compute hex SHA-256 of a string. */
function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Parse a single `.md` prompt file's raw string content.
 *
 * @param filename - Filename used for title fallback and reporting (basename, not full path).
 * @param rawContent - Full file contents including any YAML frontmatter block.
 * @returns A {@link ParsedPrompt} with defaults applied and any warnings collected.
 */
function parsePromptFile(filename: string, rawContent: string): ParsedPrompt {
  const warnings: string[] = [];

  // gray-matter handles missing/empty frontmatter gracefully (returns {} data),
  // but it can throw on malformed YAML — guard so parsing never throws.
  let body: string;
  let rawData: Record<string, unknown>;
  try {
    const parsed = matter(rawContent);
    body = parsed.content;
    rawData =
      parsed.data && typeof parsed.data === "object"
        ? (parsed.data as Record<string, unknown>)
        : {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`Failed to parse frontmatter YAML: ${message}`);
    rawData = {};
    body = rawContent;
  }

  // Detect unknown frontmatter keys before validation so authors get a hint.
  // Skip when top-level YAML is an array rather than an object.
  if (rawData && !Array.isArray(rawData)) {
    for (const key of Object.keys(rawData)) {
      if (!KNOWN_FRONTMATTER_KEYS.has(key)) {
        warnings.push(`Unknown frontmatter key: '${key}'`);
      }
    }
  }

  // Validate; on failure, surface readable issues and fall back to all-defaults.
  const result = PromptFrontmatterSchema.safeParse(rawData);
  let frontmatter: ParsedFrontmatter;
  if (result.success) {
    frontmatter = result.data;
  } else {
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      warnings.push(`Frontmatter validation error at '${path}': ${issue.message}`);
    }
    // Defaults-only fallback: schema must accept an empty object since every
    // field is either optional or has a default.
    frontmatter = PromptFrontmatterSchema.parse({});
  }

  const title = frontmatter.title ?? deriveTitleFromFilename(filename);

  return {
    filename,
    title,
    content: body,
    rawContent,
    contentHash: sha256Hex(body),
    frontmatter,
    warnings,
  };
}

export { parsePromptFile };
export type { ParsedPrompt };

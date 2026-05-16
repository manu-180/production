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

/**
 * Multiplier applied to the primary wave number when a secondary `__NN_`
 * segment is present. Encodes the "block + sub-step" filename convention
 * into a single integer so the wave-grouper sees adjacent steps as
 * different (sequential) waves, while still grouping sibling files
 * (single-number prefix or trailing-letter sibling) under the same wave.
 *
 * 1_000 chosen so the secondary number (typically 01..99, occasionally
 * up to ~26 in real plans) cannot collide with the next primary number.
 */
const SUB_STEP_WAVE_FACTOR = 1_000;

/**
 * Extract the wave number from a filename's prefix.
 *
 * The convention is permissive on purpose — humans use whatever shorthand
 * fits their language (`01-`, `T1-` for "tanda", `W1-` for "wave",
 * `wave3-`, `v2-`, etc.). We accept ANY leading run of letters as a
 * decorative prefix, then a run of digits (the wave), then an optional
 * single trailing letter that identifies parallel siblings of the same
 * wave, then a hyphen or underscore that terminates the prefix.
 *
 * Sub-step convention: when the filename also carries a secondary numeric
 * segment introduced by a double-underscore (e.g. `T3_billing-core__01_foo.md`,
 * `T3_billing-core__02_bar.md`), we combine both numbers into a synthetic
 * wave (`primary * SUB_STEP_WAVE_FACTOR + secondary`). This forces the
 * orchestrator's wave-grouper to treat `__01` and `__02` as **sequential**
 * sub-steps within the same "block", which is what the naming clearly
 * intends ("01_foundation" runs before "02_surface"). Plans that don't use
 * the `__NN_` convention are unaffected and continue to fall back to the
 * single-number behaviour.
 *
 * Examples (case-insensitive):
 *   "01-foo.md"                       → 1
 *   "01a-foo.md"                      → 1
 *   "03a-foo.md"                      → 3
 *   "03b-bar.md"                      → 3   (parallel sibling of 03a)
 *   "T1-foo.md"                       → 1   ("tanda 1" — Spanish for wave)
 *   "T1a-foo.md"                      → 1
 *   "T2-bar.md"                       → 2
 *   "W1-foo.md"                       → 1
 *   "wave3-foo.md"                    → 3
 *   "v2-hotfix.md"                    → 2
 *   "10_foo.md"                       → 10
 *   "001-foo.md"                      → 1
 *   "T3_billing-core__01_foo.md"      → 3001  (block T3, sub-step 01)
 *   "T3_billing-core__02_bar.md"      → 3002  (block T3, sub-step 02 — runs after 3001)
 *   "T10_x__03_y.md"                  → 10003
 *   "intro.md"                        → undefined (no numeric segment in prefix)
 *   "foo.md"                          → undefined
 */
function deriveWaveFromFilename(filename: string): number | undefined {
  // Drop directory portion if any was passed by mistake.
  const base = filename.replace(/^.*[\\/]/, "");
  // `^[a-z]*` — optional decorative letters (T, W, wave, v, …).
  // `(\d+)`   — the primary wave number.
  // `[a-z]?`  — optional sibling letter (a, b, c, …).
  // `[-_]`    — required separator before the rest of the filename.
  // Case-insensitive so "T1-", "t1-", "Wave1-", "WAVE1-" all work.
  const m = base.match(/^[a-z]*(\d+)[a-z]?[-_]/i);
  if (!m || m[1] === undefined) return undefined;
  // Number.parseInt with radix 10 — leading zeros are tolerated and dropped.
  const primary = Number.parseInt(m[1], 10);
  if (!Number.isFinite(primary) || primary < 0) return undefined;

  // Look for a sub-step segment introduced by a double-underscore further
  // in the filename: `<anything>__NN_<rest>`. The double underscore is
  // load-bearing — a single underscore would conflict with the existing
  // `10_foo.md` convention.
  const sub = base.match(/__(\d+)_/);
  if (sub && sub[1] !== undefined) {
    const secondary = Number.parseInt(sub[1], 10);
    if (Number.isFinite(secondary) && secondary >= 0 && secondary < SUB_STEP_WAVE_FACTOR) {
      return primary * SUB_STEP_WAVE_FACTOR + secondary;
    }
  }

  return primary;
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

  // Derive wave from filename when frontmatter didn't specify one. We mutate
  // the parsed object in place so that downstream consumers see a single,
  // consistent value regardless of the source. The plan-loader applies the
  // final fallback (unique sequential wave by order index) when this is still
  // undefined — i.e., for files without a numeric prefix.
  if (frontmatter.wave === undefined) {
    const derived = deriveWaveFromFilename(filename);
    if (derived !== undefined) {
      frontmatter.wave = derived;
    }
  }

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

export { deriveWaveFromFilename, parsePromptFile };
export type { ParsedPrompt };

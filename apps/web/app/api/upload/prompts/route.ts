import { defineRoute, respond, respondError } from "@/lib/api";
import { sha256Hex } from "@/lib/api/prompt-utils";
import type { PromptInput } from "@/lib/validators/plans";
import { parsePromptFile } from "@conductor/core";
import { unzipSync } from "fflate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Per-file caps. Tuned for prompt-sized markdown — bump when needed. */
const MAX_MD_BYTES = 1_000_000; // 1 MB
const MAX_ZIP_BYTES = 10_000_000; // 10 MB
const MAX_TOTAL_PROMPTS = 500;

interface ProcessedPrompt {
  /** Source filename from the upload. Carries through to PromptInput.filename. */
  filename: string;
  /** Parsed body without frontmatter. */
  content: string;
  /** Validated frontmatter as plain JSON. */
  frontmatter: Record<string, unknown>;
  /** Title derived from frontmatter or filename. */
  title: string;
  /** SHA-256 hex of body. Useful for client-side dedupe before POSTing. */
  content_hash: string;
  /** Non-fatal warnings from parsing (unknown keys, validation issues). */
  warnings: string[];
}

interface UploadResponse {
  prompts: ProcessedPrompt[];
  /** Filenames that were skipped (non-md, README, _drafts), with reason. */
  skipped: { filename: string; reason: string }[];
}

/**
 * POST /api/upload/prompts
 *
 * Accepts `multipart/form-data` with one or more files under any field name.
 * Supported inputs:
 *   - One or more `.md` files (uploaded directly).
 *   - One or more `.zip` files; we walk each archive and pick `.md` entries.
 *   - A mix of the above.
 *
 * The route parses but does NOT persist — the client decides what to do with
 * the returned prompts (preview, then call POST /plans with them inlined).
 */
export const POST = defineRoute({ rateLimit: "mutation" }, async ({ req, traceId }) => {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return respondError("unsupported", "expected multipart/form-data", { traceId });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    return respondError("validation", "Failed to parse multipart body", {
      traceId,
      details: { cause: err instanceof Error ? err.message : String(err) },
    });
  }

  const files: File[] = [];
  for (const value of formData.values()) {
    if (value instanceof File) files.push(value);
  }

  if (files.length === 0) {
    return respondError("validation", "no files in upload", { traceId });
  }

  const prompts: ProcessedPrompt[] = [];
  const skipped: UploadResponse["skipped"] = [];

  for (const file of files) {
    const lower = file.name.toLowerCase();

    if (lower.endsWith(".zip")) {
      if (file.size > MAX_ZIP_BYTES) {
        skipped.push({
          filename: file.name,
          reason: `zip too large (>${MAX_ZIP_BYTES} bytes)`,
        });
        continue;
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      let entries: ReturnType<typeof unzipSync>;
      try {
        entries = unzipSync(buf);
      } catch (err) {
        skipped.push({
          filename: file.name,
          reason: `invalid zip: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
      for (const [path, bytes] of Object.entries(entries)) {
        const basename = path.split("/").pop() ?? path;
        const decision = classifyName(basename);
        if (decision !== "ok") {
          skipped.push({ filename: path, reason: decision });
          continue;
        }
        if (bytes.byteLength > MAX_MD_BYTES) {
          skipped.push({ filename: path, reason: "file too large" });
          continue;
        }
        const content = decoder.decode(bytes);
        prompts.push(toProcessed(basename, content));
        if (prompts.length >= MAX_TOTAL_PROMPTS) break;
      }
    } else if (lower.endsWith(".md")) {
      if (file.size > MAX_MD_BYTES) {
        skipped.push({ filename: file.name, reason: "file too large" });
        continue;
      }
      const content = await file.text();
      const decision = classifyName(file.name);
      if (decision !== "ok") {
        skipped.push({ filename: file.name, reason: decision });
        continue;
      }
      prompts.push(toProcessed(file.name, content));
    } else {
      skipped.push({ filename: file.name, reason: "unsupported extension (expected .md or .zip)" });
    }

    if (prompts.length >= MAX_TOTAL_PROMPTS) break;
  }

  if (prompts.length === 0) {
    return respondError("validation", "no valid prompts found in upload", {
      traceId,
      details: { skipped },
    });
  }

  // Sort prompts by filename so the order matches what the user sees in
  // their file explorer (and what `loadPlanFromUploaded` would produce).
  prompts.sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));

  const response: UploadResponse = { prompts, skipped };
  return respond(response, { traceId });
});

const decoder = new TextDecoder("utf-8");

/** Returns "ok" or a human-readable reason for skipping. */
function classifyName(filename: string): "ok" | string {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".md")) return "not a .md file";
  if (lower.startsWith("readme")) return "README files are skipped";
  if (filename.startsWith("_")) return "leading underscore marks the prompt as a draft";
  return "ok";
}

function toProcessed(filename: string, content: string): ProcessedPrompt {
  const parsed = parsePromptFile(filename, content);
  return {
    filename: parsed.filename,
    content: parsed.content,
    frontmatter: parsed.frontmatter as unknown as Record<string, unknown>,
    title: parsed.title,
    content_hash: sha256Hex(parsed.content),
    warnings: parsed.warnings,
  };
}

// Type assertion — the response includes ProcessedPrompt which is a
// superset of PromptInput (extra `title`, `content_hash`, `warnings`).
// The client coerces back to PromptInput[] when posting to /api/plans.
type _AssertSuperset = ProcessedPrompt extends Pick<
  PromptInput,
  "filename" | "content" | "frontmatter"
>
  ? true
  : never;
const _check: _AssertSuperset = true;
void _check;

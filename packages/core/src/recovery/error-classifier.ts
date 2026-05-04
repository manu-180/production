/**
 * Conductor — Error Classifier (Recovery)
 *
 * Pure module: maps {@link ExecutorError} instances to a recovery
 * {@link ErrorCategory} plus retry/wait metadata. No DB, no I/O.
 *
 * Mapping (per phase 09 plan):
 *  - RATE_LIMITED          -> rate_limit, retryable, waitMs from header or 60s
 *  - AUTH_INVALID          -> auth, NOT retryable, requires human
 *  - TIMEOUT               -> transient, retryable
 *  - PARSE_ERROR           -> transient, retryable
 *  - CLI_NOT_FOUND         -> system, NOT retryable
 *  - WORKING_DIR_INVALID   -> system, NOT retryable
 *  - BUDGET_EXCEEDED       -> config, NOT retryable
 *  - MAX_TURNS_REACHED     -> config, NOT retryable
 *  - PROCESS_KILLED        -> transient, retryable (network blip / killed)
 *  - TOOL_DENIED           -> config, NOT retryable
 *  - UNKNOWN               -> unknown, retryable (best effort)
 */

import { type ExecutorError, ExecutorErrorCode } from "../executor/errors.js";
import { logger } from "../logger.js";

export type ErrorCategory =
  | "transient"
  | "idle"
  | "rate_limit"
  | "auth"
  | "config"
  | "system"
  | "unknown";

export interface ClassifiedError {
  category: ErrorCategory;
  retryable: boolean;
  waitMs?: number;
  requiresHumanAction?: boolean;
}

const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

/**
 * Extract a Retry-After hint (in milliseconds) from an ExecutorError. Looks at:
 *  1. originalError.headers['retry-after'] (number or numeric string, seconds)
 *  2. originalError.retryAfterMs / .retryAfter (numeric)
 *  3. err.message / originalError.stderr regex: `Retry-After: <n>` (seconds)
 *  4. err.message / originalError.stderr regex: `wait <n>s` / `wait <n> seconds`
 *
 * Returns null when no hint is present.
 */
export function extractRetryAfterMs(err: ExecutorError): number | null {
  const candidates: string[] = [];

  // Headers-based hints
  const orig = err.originalError;
  if (orig !== null && typeof orig === "object") {
    const o = orig as Record<string, unknown>;

    // Direct numeric fields
    const directMs = o["retryAfterMs"];
    if (typeof directMs === "number" && Number.isFinite(directMs) && directMs >= 0) {
      return Math.floor(directMs);
    }
    const directSec = o["retryAfter"];
    if (typeof directSec === "number" && Number.isFinite(directSec) && directSec >= 0) {
      return Math.floor(directSec * 1000);
    }

    const headers = o["headers"];
    if (headers !== null && typeof headers === "object") {
      const h = headers as Record<string, unknown>;
      const ra = h["retry-after"] ?? h["Retry-After"];
      if (typeof ra === "number" && Number.isFinite(ra) && ra >= 0) {
        return Math.floor(ra * 1000);
      }
      if (typeof ra === "string") {
        const n = Number.parseInt(ra, 10);
        if (Number.isFinite(n) && n >= 0) return n * 1000;
      }
    }

    if (typeof o["stderr"] === "string") candidates.push(o["stderr"]);
    if (typeof o["stdout"] === "string") candidates.push(o["stdout"]);
    if (typeof o["message"] === "string") candidates.push(o["message"]);
  }

  if (typeof err.message === "string" && err.message.length > 0) {
    candidates.push(err.message);
  }

  for (const text of candidates) {
    const headerMatch = text.match(/Retry-After:\s*(\d+)/i);
    if (headerMatch?.[1]) {
      const n = Number.parseInt(headerMatch[1], 10);
      if (Number.isFinite(n) && n >= 0) return n * 1000;
    }
    const waitMatch = text.match(/wait\s+(\d+)\s*(?:s|sec|seconds?)/i);
    if (waitMatch?.[1]) {
      const n = Number.parseInt(waitMatch[1], 10);
      if (Number.isFinite(n) && n >= 0) return n * 1000;
    }
  }

  return null;
}

/**
 * Classify an ExecutorError into a recovery category and retry decision.
 * Pure / synchronous. Always returns a result (never throws on unknown codes).
 */
export function classifyError(err: ExecutorError): ClassifiedError {
  switch (err.code) {
    case ExecutorErrorCode.RATE_LIMITED: {
      const hint = extractRetryAfterMs(err);
      const waitMs = hint !== null ? hint : DEFAULT_RATE_LIMIT_WAIT_MS;
      return { category: "rate_limit", retryable: true, waitMs };
    }
    case ExecutorErrorCode.AUTH_INVALID:
      return { category: "auth", retryable: false, requiresHumanAction: true };
    case ExecutorErrorCode.TIMEOUT:
      return { category: "transient", retryable: true };
    case ExecutorErrorCode.IDLE_STALL:
      return { category: "idle", retryable: true, waitMs: 5_000 };
    case ExecutorErrorCode.PARSE_ERROR:
      return { category: "transient", retryable: true };
    case ExecutorErrorCode.PROCESS_KILLED:
      return { category: "transient", retryable: true };
    case ExecutorErrorCode.CLI_NOT_FOUND:
      return { category: "system", retryable: false, requiresHumanAction: true };
    case ExecutorErrorCode.WORKING_DIR_INVALID:
      return { category: "system", retryable: false, requiresHumanAction: true };
    case ExecutorErrorCode.BUDGET_EXCEEDED:
      return { category: "config", retryable: false };
    case ExecutorErrorCode.MAX_TURNS_REACHED:
      return { category: "config", retryable: false };
    case ExecutorErrorCode.TOOL_DENIED:
      return { category: "config", retryable: false };
    case ExecutorErrorCode.UNKNOWN:
      return { category: "unknown", retryable: true };
    default:
      logger.warn({ code: err.code, message: err.message }, "error-classifier.unknown_code");
      return { category: "unknown", retryable: true };
  }
}

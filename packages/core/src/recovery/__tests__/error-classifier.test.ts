import { describe, expect, it } from "vitest";
import { ExecutorError, ExecutorErrorCode } from "../../executor/errors.js";
import { classifyError, extractRetryAfterMs } from "../error-classifier.js";

function makeErr(
  code: ExecutorErrorCode,
  message = "x",
  originalError?: unknown,
): ExecutorError {
  return new ExecutorError(code, message, originalError !== undefined ? { originalError } : {});
}

describe("classifyError", () => {
  it("RATE_LIMITED -> rate_limit, retryable, default 60s wait", () => {
    const r = classifyError(makeErr(ExecutorErrorCode.RATE_LIMITED));
    expect(r.category).toBe("rate_limit");
    expect(r.retryable).toBe(true);
    expect(r.waitMs).toBe(60_000);
  });

  it("RATE_LIMITED uses Retry-After header (numeric seconds) when present", () => {
    const err = makeErr(ExecutorErrorCode.RATE_LIMITED, "rate limited", {
      headers: { "retry-after": 30 },
    });
    const r = classifyError(err);
    expect(r.waitMs).toBe(30_000);
  });

  it("RATE_LIMITED uses Retry-After header (string seconds)", () => {
    const err = makeErr(ExecutorErrorCode.RATE_LIMITED, "x", {
      headers: { "Retry-After": "12" },
    });
    expect(classifyError(err).waitMs).toBe(12_000);
  });

  it("RATE_LIMITED parses 'Retry-After: N' from stderr", () => {
    const err = makeErr(ExecutorErrorCode.RATE_LIMITED, "x", {
      stderr: "Server said: Retry-After: 7\n",
    });
    expect(classifyError(err).waitMs).toBe(7_000);
  });

  it("RATE_LIMITED parses 'wait Ns' from message", () => {
    const err = makeErr(ExecutorErrorCode.RATE_LIMITED, "please wait 45 seconds and retry");
    expect(classifyError(err).waitMs).toBe(45_000);
  });

  it("AUTH_INVALID -> auth, NOT retryable, requiresHumanAction", () => {
    const r = classifyError(makeErr(ExecutorErrorCode.AUTH_INVALID));
    expect(r.category).toBe("auth");
    expect(r.retryable).toBe(false);
    expect(r.requiresHumanAction).toBe(true);
  });

  it("TIMEOUT -> transient, retryable", () => {
    const r = classifyError(makeErr(ExecutorErrorCode.TIMEOUT));
    expect(r.category).toBe("transient");
    expect(r.retryable).toBe(true);
  });

  it("PARSE_ERROR -> transient, retryable", () => {
    const r = classifyError(makeErr(ExecutorErrorCode.PARSE_ERROR));
    expect(r.category).toBe("transient");
    expect(r.retryable).toBe(true);
  });

  it("CLI_NOT_FOUND -> system, NOT retryable", () => {
    const r = classifyError(makeErr(ExecutorErrorCode.CLI_NOT_FOUND));
    expect(r.category).toBe("system");
    expect(r.retryable).toBe(false);
    expect(r.requiresHumanAction).toBe(true);
  });

  it("WORKING_DIR_INVALID -> system, NOT retryable", () => {
    const r = classifyError(makeErr(ExecutorErrorCode.WORKING_DIR_INVALID));
    expect(r.category).toBe("system");
    expect(r.retryable).toBe(false);
  });

  it("BUDGET_EXCEEDED -> config, NOT retryable", () => {
    const r = classifyError(makeErr(ExecutorErrorCode.BUDGET_EXCEEDED));
    expect(r.category).toBe("config");
    expect(r.retryable).toBe(false);
  });

  it("MAX_TURNS_REACHED -> config, NOT retryable", () => {
    const r = classifyError(makeErr(ExecutorErrorCode.MAX_TURNS_REACHED));
    expect(r.category).toBe("config");
    expect(r.retryable).toBe(false);
  });

  it("TOOL_DENIED -> config, NOT retryable", () => {
    const r = classifyError(makeErr(ExecutorErrorCode.TOOL_DENIED));
    expect(r.category).toBe("config");
    expect(r.retryable).toBe(false);
  });

  it("PROCESS_KILLED -> transient, retryable", () => {
    const r = classifyError(makeErr(ExecutorErrorCode.PROCESS_KILLED));
    expect(r.category).toBe("transient");
    expect(r.retryable).toBe(true);
  });

  it("UNKNOWN -> unknown, retryable", () => {
    const r = classifyError(makeErr(ExecutorErrorCode.UNKNOWN));
    expect(r.category).toBe("unknown");
    expect(r.retryable).toBe(true);
  });
});

describe("extractRetryAfterMs", () => {
  it("returns null when no hint present", () => {
    expect(extractRetryAfterMs(makeErr(ExecutorErrorCode.RATE_LIMITED, "no hint"))).toBeNull();
  });

  it("prefers retryAfterMs (already in ms)", () => {
    const err = makeErr(ExecutorErrorCode.RATE_LIMITED, "x", { retryAfterMs: 1500 });
    expect(extractRetryAfterMs(err)).toBe(1500);
  });

  it("uses retryAfter (seconds) field", () => {
    const err = makeErr(ExecutorErrorCode.RATE_LIMITED, "x", { retryAfter: 4 });
    expect(extractRetryAfterMs(err)).toBe(4000);
  });

  it("ignores negative or non-finite values", () => {
    const err = makeErr(ExecutorErrorCode.RATE_LIMITED, "x", {
      headers: { "retry-after": -10 },
    });
    // Negative numeric header is rejected; falls through to no match.
    expect(extractRetryAfterMs(err)).toBeNull();
  });
});

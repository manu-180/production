export enum ExecutorErrorCode {
  CLI_NOT_FOUND = "CLI_NOT_FOUND",
  AUTH_INVALID = "AUTH_INVALID",
  RATE_LIMITED = "RATE_LIMITED",
  TIMEOUT = "TIMEOUT",
  IDLE_STALL = "IDLE_STALL",
  PROCESS_KILLED = "PROCESS_KILLED",
  PARSE_ERROR = "PARSE_ERROR",
  TOOL_DENIED = "TOOL_DENIED",
  MAX_TURNS_REACHED = "MAX_TURNS_REACHED",
  BUDGET_EXCEEDED = "BUDGET_EXCEEDED",
  WORKING_DIR_INVALID = "WORKING_DIR_INVALID",
  UNKNOWN = "UNKNOWN",
}

const RETRYABLE_CODES: ReadonlySet<ExecutorErrorCode> = new Set([
  ExecutorErrorCode.RATE_LIMITED,
  ExecutorErrorCode.TIMEOUT,
  ExecutorErrorCode.UNKNOWN,
]);

export interface ExecutorErrorOptions {
  retryable?: boolean;
  originalError?: unknown;
}

export class ExecutorError extends Error {
  public readonly code: ExecutorErrorCode;
  public readonly retryable: boolean;
  public readonly originalError?: unknown;

  constructor(code: ExecutorErrorCode, message: string, options: ExecutorErrorOptions = {}) {
    super(message);
    this.name = "ExecutorError";
    this.code = code;
    this.retryable = options.retryable ?? RETRYABLE_CODES.has(code);
    if (options.originalError !== undefined) {
      this.originalError = options.originalError;
    }
    Object.setPrototypeOf(this, ExecutorError.prototype);
  }

  static from(
    err: unknown,
    fallback: ExecutorErrorCode = ExecutorErrorCode.UNKNOWN,
  ): ExecutorError {
    if (err instanceof ExecutorError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new ExecutorError(fallback, message, { originalError: err });
  }
}

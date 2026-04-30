import { NextResponse } from "next/server";
import { TRACE_ID_HEADER } from "./trace";

/**
 * Stable error codes returned to API clients.
 * Frontend can branch on these without parsing messages.
 */
export type ApiErrorCode =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unsupported"
  | "internal";

const CODE_TO_STATUS: Record<ApiErrorCode, number> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  unsupported: 415,
  internal: 500,
};

export interface ApiErrorBody {
  error: ApiErrorCode;
  message: string;
  details?: unknown;
  traceId: string;
}

interface RespondOptions {
  status?: number;
  traceId: string;
  headers?: HeadersInit;
}

interface RespondErrorOptions {
  traceId: string;
  details?: unknown;
  status?: number;
  headers?: HeadersInit;
}

function withTraceHeader(traceId: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set(TRACE_ID_HEADER, traceId);
  return headers;
}

/** Success response. Always sets `x-trace-id` so clients can echo it back when reporting issues. */
export function respond<T>(data: T, opts: RespondOptions): NextResponse {
  return NextResponse.json(data, {
    status: opts.status ?? 200,
    headers: withTraceHeader(opts.traceId, opts.headers),
  });
}

/** Error response with a stable code, machine-friendly details, and traceId. */
export function respondError(
  code: ApiErrorCode,
  message: string,
  opts: RespondErrorOptions,
): NextResponse {
  const body: ApiErrorBody = {
    error: code,
    message,
    traceId: opts.traceId,
    ...(opts.details !== undefined ? { details: opts.details } : {}),
  };
  return NextResponse.json(body, {
    status: opts.status ?? CODE_TO_STATUS[code],
    headers: withTraceHeader(opts.traceId, opts.headers),
  });
}

export function respondNoContent(traceId: string): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: withTraceHeader(traceId),
  });
}

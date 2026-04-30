import { randomUUID } from "node:crypto";

const TRACE_HEADER = "x-trace-id";

/** Generate a fresh traceId for a request that doesn't carry one. */
export function generateTraceId(): string {
  return randomUUID();
}

/**
 * Resolve a traceId for the current request.
 * Honors an inbound `x-trace-id` header if present (caller propagates it),
 * otherwise mints a new UUID. The same traceId travels with the response
 * and into log lines so a single request can be correlated end-to-end.
 */
export function resolveTraceId(req: Request): string {
  const inbound = req.headers.get(TRACE_HEADER);
  if (inbound !== null && inbound.trim() !== "") return inbound;
  return generateTraceId();
}

export const TRACE_ID_HEADER = TRACE_HEADER;

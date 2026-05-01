import type { ApiErrorBody, ApiErrorCode } from "@/lib/api/respond";

export class ApiClientError extends Error {
  readonly code: ApiErrorCode | "network";
  readonly status: number;
  readonly traceId: string;
  readonly details?: unknown;

  constructor(
    code: ApiErrorCode | "network",
    status: number,
    message: string,
    traceId: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.traceId = traceId;
    this.details = details;
  }
}

interface RequestOpts {
  signal?: AbortSignal;
  headers?: HeadersInit;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: RequestOpts,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...opts?.headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: opts?.signal,
      credentials: "same-origin",
    });
  } catch (err) {
    throw new ApiClientError(
      "network",
      0,
      err instanceof Error ? err.message : "Network error",
      "unknown",
    );
  }

  const traceId = res.headers.get("x-trace-id") ?? "unknown";
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const e = parsed as Partial<ApiErrorBody> | null;
    throw new ApiClientError(
      (e?.error as ApiErrorCode) ?? "internal",
      res.status,
      e?.message ?? `HTTP ${res.status}`,
      e?.traceId ?? traceId,
      e?.details,
    );
  }
  return parsed as T;
}

export const apiClient = {
  get: <T>(path: string, opts?: RequestOpts) => request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOpts) =>
    request<T>("POST", path, body, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOpts) => request<T>("PUT", path, body, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOpts) =>
    request<T>("PATCH", path, body, opts),
  delete: <T>(path: string, opts?: RequestOpts) => request<T>("DELETE", path, undefined, opts),
};

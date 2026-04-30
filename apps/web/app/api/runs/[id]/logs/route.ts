import { respond, respondError } from "@/lib/api";
import { getAuthedUser } from "@/lib/api/auth";
import { pickLimiter } from "@/lib/api/rate-limit";
import { assertRunOwned } from "@/lib/api/run-utils";
import { TRACE_ID_HEADER, resolveTraceId } from "@/lib/api/trace";
import { logsQuerySchema } from "@/lib/validators/runs";
import type { ServiceClient } from "@conductor/db";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;

interface Params {
  id: string;
}

interface OutputChunkRow {
  id: number;
  channel: string;
  content: string | null;
  created_at: string;
  prompt_execution_id: string;
}

/**
 * GET /api/runs/:id/logs — paginated `output_chunks` for a run.
 *
 * Cursor differs from plans/runs lists: `output_chunks.id` is a bigint, so we
 * use a strictly numeric cursor (last seen id) instead of the `(created_at, id)`
 * tuple pattern. Ordering is ASC so consumers can append to a buffer.
 *
 * Filters:
 *   - `?promptId=` — narrow to a single prompt execution
 *   - `?channel=stdout|stderr|claude`
 *
 * Modes:
 *   - default JSON: `{ chunks, nextCursor }`, capped at `?limit=` (default 500, max 5000)
 *   - `?stream=true` → NDJSON streaming response (one chunk per line, then EOF)
 */
export async function GET(req: NextRequest, ctx: { params: Promise<Params> }): Promise<Response> {
  const traceId = resolveTraceId(req);
  const auth = await getAuthedUser(req);
  if (!auth.ok) {
    return respondError("unauthorized", "Authentication required", { traceId });
  }
  const { user } = auth;

  // Validate query first so an invalid `?stream=foo` doesn't downgrade silently.
  const rawQuery = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = logsQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return respondError("validation", "Invalid query parameters", {
      traceId,
      details: parsed.error.issues,
    });
  }
  const query = parsed.data;

  if (query.stream === true) {
    // Stream mode shares the stream rate-limit tier — opening 50 NDJSON
    // streams in parallel is just as bad as 50 SSE connections.
    const limiter = pickLimiter("stream");
    if (limiter !== null) {
      const result = limiter.check(`stream:${user.userId}`);
      if (!result.allowed) {
        const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
        return respondError("rate_limited", "Too many log streams", {
          traceId,
          details: { retryAfterSec },
          headers: { "Retry-After": String(retryAfterSec) },
        });
      }
    }
  } else {
    const limiter = pickLimiter("general");
    if (limiter !== null) {
      const result = limiter.check(`general:${user.userId}`);
      if (!result.allowed) {
        const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
        return respondError("rate_limited", "Too many requests", {
          traceId,
          details: { retryAfterSec },
          headers: { "Retry-After": String(retryAfterSec) },
        });
      }
    }
  }

  const { id: runId } = await ctx.params;
  const owned = await assertRunOwned(user.db, runId, user.userId);
  if (owned === null) {
    return respondError("not_found", "Run not found", { traceId });
  }

  const promptExecutionIds = await resolveExecutionIds(user.db, owned.id, query.promptId);
  if (promptExecutionIds.length === 0) {
    if (query.stream === true) {
      return new Response("", {
        headers: ndjsonHeaders(traceId),
      });
    }
    return respond({ chunks: [], nextCursor: undefined }, { traceId });
  }

  const cursorId = parseNumericCursor(query.cursor);
  // `paginationQuerySchema` defaults `limit` to 20 — way too small for log
  // tail scenarios, so we override the default and clamp upper-bound.
  const explicit = req.nextUrl.searchParams.get("limit");
  const limit = explicit === null ? DEFAULT_LIMIT : Math.min(MAX_LIMIT, Math.max(1, query.limit));

  const buildQuery = () => {
    let q = user.db
      .from("output_chunks")
      .select("id, channel, content, created_at, prompt_execution_id")
      .in("prompt_execution_id", promptExecutionIds)
      .order("id", { ascending: true })
      .limit(limit);
    if (cursorId !== null) q = q.gt("id", cursorId);
    if (query.channel !== undefined) q = q.eq("channel", query.channel);
    return q;
  };

  if (query.stream === true) {
    return new Response(buildNdjsonStream(buildQuery, req.signal), {
      headers: ndjsonHeaders(traceId),
    });
  }

  const { data, error } = await buildQuery();
  if (error !== null) {
    return respondError("internal", "Failed to load logs", {
      traceId,
      details: { code: error.code },
    });
  }

  const chunks = (data ?? []) as OutputChunkRow[];
  const nextCursor =
    chunks.length === limit ? encodeNumericCursor(chunks[chunks.length - 1]?.id) : undefined;

  return respond({ chunks, nextCursor }, { traceId });
}

function ndjsonHeaders(traceId: string): Record<string, string> {
  return {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    [TRACE_ID_HEADER]: traceId,
  };
}

type QueryRunner = () => PromiseLike<{
  data: unknown;
  error: { code?: string; message?: string } | null;
}>;

function buildNdjsonStream(
  runQuery: QueryRunner,
  abortSignal: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };
      abortSignal.addEventListener("abort", close, { once: true });

      try {
        const { data, error } = await runQuery();
        if (error !== null) {
          controller.enqueue(
            encoder.encode(`${JSON.stringify({ error: error.message ?? "log_query_failed" })}\n`),
          );
          close();
          return;
        }
        for (const chunk of (data ?? []) as OutputChunkRow[]) {
          if (closed) return;
          controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ error: err instanceof Error ? err.message : "stream_failed" })}\n`,
          ),
        );
      } finally {
        close();
      }
    },
  });
}

async function resolveExecutionIds(
  db: ServiceClient,
  runId: string,
  promptId: string | undefined,
): Promise<string[]> {
  if (promptId !== undefined) {
    const { data } = await db
      .from("prompt_executions")
      .select("id")
      .eq("run_id", runId)
      .eq("prompt_id", promptId);
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  }
  const { data } = await db.from("prompt_executions").select("id").eq("run_id", runId);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}

function parseNumericCursor(cursor: string | undefined): number | null {
  if (cursor === undefined) return null;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const n = Number.parseInt(decoded, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function encodeNumericCursor(id: number | undefined): string | undefined {
  if (id === undefined) return undefined;
  return Buffer.from(String(id), "utf8").toString("base64url");
}

import { getAuthedUser } from "@/lib/api/auth";
import { pickLimiter } from "@/lib/api/rate-limit";
import { respondError } from "@/lib/api/respond";
import { assertRunOwned } from "@/lib/api/run-utils";
import { TRACE_ID_HEADER, resolveTraceId } from "@/lib/api/trace";
import type { ServiceClient } from "@conductor/db";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 15_000;
/**
 * Vercel caps Node runtime responses at ~60s. We close earlier so the client
 * receives a clean `event: timeout` instead of a 504, then can reconnect.
 */
const MAX_LIFETIME_MS = 50_000;
const SNAPSHOT_RECENT_EVENTS = 50;
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

interface Params {
  id: string;
}

interface RunEventRow {
  id: number;
  sequence: number;
  event_type: string;
  payload: unknown;
  prompt_execution_id: string | null;
  created_at: string;
}

/**
 * GET /api/runs/:id/stream — Server-Sent Events fallback.
 *
 * Supabase Realtime is the preferred channel; this endpoint exists for clients
 * that can't (or won't) subscribe. We poll `run_events` every 1.5s, emit one
 * SSE message per row, and close once the run hits a terminal status. Vercel
 * caps Node responses around 60s — we self-terminate at 50s so the client
 * sees a clean `event: timeout` and can reconnect from the last sequence.
 *
 * `defineRoute` is intentionally bypassed: SSE needs a long-lived
 * `ReadableStream` and full control over headers (`X-Accel-Buffering: no`),
 * which the wrapper isn't shaped to provide. Auth, rate-limit and traceId are
 * applied manually using the same helpers.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<Params> }): Promise<Response> {
  const traceId = resolveTraceId(req);
  const auth = await getAuthedUser(req);
  if (!auth.ok) {
    return respondError("unauthorized", "Authentication required", { traceId });
  }
  const { user } = auth;

  const limiter = pickLimiter("stream");
  if (limiter !== null) {
    const result = limiter.check(`stream:${user.userId}`);
    if (!result.allowed) {
      const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      return respondError("rate_limited", "Too many SSE connections", {
        traceId,
        details: { retryAfterSec, resetAt: new Date(result.resetAt).toISOString() },
        headers: { "Retry-After": String(retryAfterSec) },
      });
    }
  }

  const { id: runId } = await ctx.params;
  const owned = await assertRunOwned(user.db, runId, user.userId);
  if (owned === null) {
    return respondError("not_found", "Run not found", { traceId });
  }

  const stream = buildEventStream({
    db: user.db,
    runId: owned.id,
    abortSignal: req.signal,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      [TRACE_ID_HEADER]: traceId,
    },
  });
}

interface StreamOptions {
  db: ServiceClient;
  runId: string;
  abortSignal: AbortSignal;
}

function buildEventStream(opts: StreamOptions): ReadableStream<Uint8Array> {
  const { db, runId, abortSignal } = opts;
  const encoder = new TextEncoder();
  let lastSequence = -1;
  let pollTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let lifetimeTimer: NodeJS.Timeout | null = null;
  let closed = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller may already be closed (client disconnect).
        }
      };

      const close = (reason?: { event: string; data?: unknown }): void => {
        if (closed) return;
        closed = true;
        if (reason !== undefined) {
          safeEnqueue(formatSseEvent(reason.event, reason.data ?? {}));
        }
        if (pollTimer !== null) clearInterval(pollTimer);
        if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
        if (lifetimeTimer !== null) clearTimeout(lifetimeTimer);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      // ── Snapshot ──────────────────────────────────────────────────────────
      const [{ data: run }, { data: executions }, { data: recentEvents }] = await Promise.all([
        db.from("runs").select("*").eq("id", runId).maybeSingle(),
        db.from("prompt_executions").select("*").eq("run_id", runId),
        db
          .from("run_events")
          .select("id, sequence, event_type, payload, prompt_execution_id, created_at")
          .eq("run_id", runId)
          .order("sequence", { ascending: false })
          .limit(SNAPSHOT_RECENT_EVENTS),
      ]);

      const snapshotEvents = ((recentEvents ?? []) as RunEventRow[]).slice().reverse();
      for (const ev of snapshotEvents) {
        if (ev.sequence > lastSequence) lastSequence = ev.sequence;
      }

      safeEnqueue(
        formatSseEvent("snapshot", {
          run: run ?? { id: runId },
          executions: executions ?? [],
          recentEvents: snapshotEvents,
        }),
      );

      if (run !== null && TERMINAL_STATUSES.has(String(run.status))) {
        close({ event: "closed", data: { reason: "terminal_status", status: run.status } });
        return;
      }

      // ── Polling loop ──────────────────────────────────────────────────────
      const pollOnce = async (): Promise<void> => {
        if (closed) return;
        try {
          const { data: events } = await db
            .from("run_events")
            .select("id, sequence, event_type, payload, prompt_execution_id, created_at")
            .eq("run_id", runId)
            .gt("sequence", lastSequence)
            .order("sequence", { ascending: true })
            .limit(200);

          for (const ev of (events ?? []) as RunEventRow[]) {
            if (ev.sequence > lastSequence) lastSequence = ev.sequence;
            safeEnqueue(formatSseEvent(ev.event_type, ev));
          }

          const { data: latestRun } = await db
            .from("runs")
            .select("status")
            .eq("id", runId)
            .maybeSingle();

          if (latestRun !== null && TERMINAL_STATUSES.has(String(latestRun.status))) {
            close({
              event: "closed",
              data: { reason: "terminal_status", status: latestRun.status },
            });
          }
        } catch (err) {
          close({
            event: "error",
            data: { reason: err instanceof Error ? err.message : "poll_failed" },
          });
        }
      };

      pollTimer = setInterval(() => {
        void pollOnce();
      }, POLL_INTERVAL_MS);

      heartbeatTimer = setInterval(() => {
        // SSE comments (`:` prefix) keep the connection warm without firing a
        // listener on the client side.
        safeEnqueue(": heartbeat\n\n");
      }, HEARTBEAT_INTERVAL_MS);

      lifetimeTimer = setTimeout(() => {
        close({ event: "timeout", data: { lastSequence } });
      }, MAX_LIFETIME_MS);

      abortSignal.addEventListener(
        "abort",
        () => {
          close();
        },
        { once: true },
      );
    },

    cancel() {
      closed = true;
      if (pollTimer !== null) clearInterval(pollTimer);
      if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
      if (lifetimeTimer !== null) clearTimeout(lifetimeTimer);
    },
  });
}

/**
 * Format a single SSE message. Exported for unit testing — the polling loop
 * itself is too time-sensitive to test reliably, but the formatter is pure.
 */
export function formatSseEvent(event: string, data: unknown): string {
  const json = JSON.stringify(data);
  return `event: ${event}\ndata: ${json}\n\n`;
}

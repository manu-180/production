import { DbStub } from "@/lib/api/__tests__/db-stub";
import * as authModule from "@/lib/api/auth";
import { streamLimiter } from "@/lib/api/rate-limit";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, formatSseEvent } from "../route";

function req(url: string, opts: { abort?: AbortController } = {}): NextRequest {
  // NextRequest's RequestInit is narrower than the global one; cast through
  // unknown so TS accepts the AbortSignal we want for cancellation tests.
  const init = { method: "GET", signal: opts.abort?.signal } as unknown as ConstructorParameters<
    typeof NextRequest
  >[1];
  return new NextRequest(url, init);
}

describe("formatSseEvent", () => {
  it("encodes event name and JSON-serialized data", () => {
    const out = formatSseEvent("snapshot", { a: 1, b: "x" });
    expect(out).toBe('event: snapshot\ndata: {"a":1,"b":"x"}\n\n');
  });

  it("handles arrays and nested objects", () => {
    const out = formatSseEvent("delta", [{ id: 1 }, { id: 2 }]);
    expect(out).toBe('event: delta\ndata: [{"id":1},{"id":2}]\n\n');
  });
});

describe("GET /api/runs/:id/stream", () => {
  let db: DbStub;
  beforeEach(() => {
    db = new DbStub();
    vi.spyOn(authModule, "getAuthedUser").mockResolvedValue({
      ok: true,
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      user: { userId: "u1", db: db as any },
    });
    streamLimiter.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns 404 when run is missing", async () => {
    db.enqueue("runs", { data: null, error: null });
    const res = await GET(req("http://x/api/runs/r1/stream"), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(404);
  });

  it("opens an SSE response with the right headers when ownership passes", async () => {
    db.enqueue("runs", {
      data: { id: "r1", status: "completed", plan_id: "p1", working_dir: "/w" },
      error: null,
    });
    // Snapshot queries (run, executions, recent events) — runs is fetched
    // again inside the snapshot. Then no polling since terminal.
    db.enqueue("runs", { data: { id: "r1", status: "completed" }, error: null });
    db.enqueue("prompt_executions", { data: [], error: null });
    db.enqueue("run_events", { data: [], error: null });

    const abort = new AbortController();
    const res = await GET(req("http://x/api/runs/r1/stream", { abort }), {
      params: Promise.resolve({ id: "r1" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(res.headers.get("x-trace-id")).toBeTruthy();
    abort.abort();
    // Drain so the controller doesn't hang the test.
    await res.body?.getReader().cancel();
  });
});

import { DbStub } from "@/lib/api/__tests__/db-stub";
import * as authModule from "@/lib/api/auth";
import { generalLimiter, streamLimiter } from "@/lib/api/rate-limit";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../route";

function req(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

describe("GET /api/runs/:id/logs", () => {
  let db: DbStub;
  beforeEach(() => {
    db = new DbStub();
    vi.spyOn(authModule, "getAuthedUser").mockResolvedValue({
      ok: true,
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      user: { userId: "u1", db: db as any },
    });
    generalLimiter.clear();
    streamLimiter.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns 404 when run does not belong to the user", async () => {
    db.enqueue("runs", { data: null, error: null });
    const res = await GET(req("http://x/api/runs/r1/logs"), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns empty chunks when the run has no executions", async () => {
    db.enqueue("runs", {
      data: { id: "r1", status: "running", plan_id: "p1", working_dir: "/w" },
      error: null,
    });
    db.enqueue("prompt_executions", { data: [], error: null });
    const res = await GET(req("http://x/api/runs/r1/logs"), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chunks).toEqual([]);
    expect(body.nextCursor).toBeUndefined();
  });

  it("returns chunks and a nextCursor when the page is full", async () => {
    db.enqueue("runs", {
      data: { id: "r1", status: "running", plan_id: "p1", working_dir: "/w" },
      error: null,
    });
    db.enqueue("prompt_executions", { data: [{ id: "e1" }, { id: "e2" }], error: null });

    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: i + 1,
      channel: "stdout",
      content: `line ${i}`,
      created_at: `2026-04-30T00:00:0${i}Z`,
      prompt_execution_id: "e1",
    }));
    db.enqueue("output_chunks", { data: rows, error: null });

    const res = await GET(req("http://x/api/runs/r1/logs?limit=3"), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chunks).toHaveLength(3);
    expect(typeof body.nextCursor).toBe("string");
  });

  it("rejects an invalid channel with 400", async () => {
    const res = await GET(req("http://x/api/runs/r1/logs?channel=bogus"), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns NDJSON when ?stream=true", async () => {
    db.enqueue("runs", {
      data: { id: "r1", status: "running", plan_id: "p1", working_dir: "/w" },
      error: null,
    });
    db.enqueue("prompt_executions", { data: [{ id: "e1" }], error: null });
    db.enqueue("output_chunks", {
      data: [
        {
          id: 1,
          channel: "stdout",
          content: "hello",
          created_at: "2026-04-30T00:00:00Z",
          prompt_execution_id: "e1",
        },
      ],
      error: null,
    });

    const res = await GET(req("http://x/api/runs/r1/logs?stream=true"), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/x-ndjson/);
    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] as string);
    expect(parsed.id).toBe(1);
  });
});

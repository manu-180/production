import { DbStub } from "@/lib/api/__tests__/db-stub";
import * as authModule from "@/lib/api/auth";
import { generalLimiter } from "@/lib/api/rate-limit";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../route";

function req(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

describe("GET /api/runs/:id/decisions", () => {
  let db: DbStub;
  beforeEach(() => {
    db = new DbStub();
    vi.spyOn(authModule, "getAuthedUser").mockResolvedValue({
      ok: true,
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      user: { userId: "u1", db: db as any },
    });
    generalLimiter.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("404s when the run is not owned", async () => {
    db.enqueue("runs", { data: null, error: null });
    const res = await GET(req("http://x/api/runs/r1/decisions"), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns an empty list when the run has no executions", async () => {
    db.enqueue("runs", {
      data: { id: "r1", status: "running", plan_id: "p1", working_dir: "/w" },
      error: null,
    });
    db.enqueue("prompt_executions", { data: [], error: null });
    const res = await GET(req("http://x/api/runs/r1/decisions"), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decisions).toEqual([]);
  });

  it("returns decisions ordered by created_at and applies the reviewed filter", async () => {
    db.enqueue("runs", {
      data: { id: "r1", status: "running", plan_id: "p1", working_dir: "/w" },
      error: null,
    });
    db.enqueue("prompt_executions", { data: [{ id: "e1" }], error: null });
    db.enqueue("guardian_decisions", {
      data: [
        {
          id: "d1",
          prompt_execution_id: "e1",
          decision: "respond",
          reviewed_by_human: true,
          human_override: "yes do it",
          created_at: "2026-04-30T00:00:00Z",
        },
      ],
      error: null,
    });

    const res = await GET(req("http://x/api/runs/r1/decisions?reviewed=true"), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decisions).toHaveLength(1);
    // Verify the filter was applied to the query.
    const ops = db.opsFor("guardian_decisions");
    const eq = ops.find((op) => op.op === "eq" && op.args[0] === "reviewed_by_human");
    expect(eq).toBeDefined();
    expect(eq?.args[1]).toBe(true);
  });
});

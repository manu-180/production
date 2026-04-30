import { DbStub } from "@/lib/api/__tests__/db-stub";
import * as authModule from "@/lib/api/auth";
import { generalLimiter } from "@/lib/api/rate-limit";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../route";

function req(): NextRequest {
  return new NextRequest("http://x/api/runs/r1/guardian/metrics", { method: "GET" });
}

describe("GET /api/runs/:id/guardian/metrics", () => {
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
    const res = await GET(req(), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(404);
  });

  it("returns EMPTY_METRICS when there are no executions", async () => {
    db.enqueue("runs", {
      data: { id: "r1", status: "running", plan_id: "p1", working_dir: "/w" },
      error: null,
    });
    db.enqueue("prompt_executions", { data: [], error: null });
    const res = await GET(req(), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalInterventions).toBe(0);
  });

  it("aggregates metrics from guardian_decisions using the correct columns", async () => {
    db.enqueue("runs", {
      data: { id: "r1", status: "running", plan_id: "p1", working_dir: "/w" },
      error: null,
    });
    db.enqueue("prompt_executions", { data: [{ id: "e1" }], error: null });
    db.enqueue("guardian_decisions", {
      data: [
        {
          strategy: "rule",
          confidence: 0.9,
          reviewed_by_human: true,
          human_override: "yes",
        },
        {
          strategy: "llm",
          confidence: 0.4,
          reviewed_by_human: false,
          human_override: null,
        },
      ],
      error: null,
    });

    const res = await GET(req(), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalInterventions).toBe(2);
    expect(body.byStrategy.rule).toBe(1);
    expect(body.byStrategy.llm).toBe(1);
    expect(body.overrideRate).toBeCloseTo(0.5, 2);

    // Verify the select used the correct column names (no overridden_by_human).
    const selectOps = db.opsFor("guardian_decisions").filter((op) => op.op === "select");
    expect(selectOps.length).toBeGreaterThan(0);
    const selectArg = selectOps[0]?.args[0] as string;
    expect(selectArg).toContain("reviewed_by_human");
    expect(selectArg).toContain("human_override");
    expect(selectArg).not.toContain("overridden_by_human");
  });
});

import { DbStub } from "@/lib/api/__tests__/db-stub";
import * as authModule from "@/lib/api/auth";
import { mutationLimiter } from "@/lib/api/rate-limit";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH } from "../route";

function jsonReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/runs/:id/guardian/decisions/:decisionId (legacy)", () => {
  let db: DbStub;
  beforeEach(() => {
    db = new DbStub();
    vi.spyOn(authModule, "getAuthedUser").mockResolvedValue({
      ok: true,
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      user: { userId: "u1", db: db as any },
    });
    mutationLimiter.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("writes human_override and reviewed_by_human (not the legacy column names)", async () => {
    db.enqueue("runs", {
      data: { id: "r1", status: "running", plan_id: "p1", working_dir: "/w" },
      error: null,
    });
    db.enqueue("guardian_decisions", {
      data: { id: "d1", prompt_execution_id: "e1" },
      error: null,
    });
    db.enqueue("prompt_executions", { data: { id: "e1", run_id: "r1" }, error: null });
    db.enqueue("guardian_decisions", { data: null, error: null });

    const res = await PATCH(
      jsonReq("http://x/api/runs/r1/guardian/decisions/d1", { overrideResponse: "approved" }),
      { params: Promise.resolve({ id: "r1", decisionId: "d1" }) },
    );
    expect(res.status).toBe(200);

    const updateOp = db.opsFor("guardian_decisions").find((op) => op.op === "update");
    expect(updateOp).toBeDefined();
    const payload = updateOp?.args[0] as Record<string, unknown>;
    expect(payload["human_override"]).toBe("approved");
    expect(payload["reviewed_by_human"]).toBe(true);
    expect(payload).not.toHaveProperty("overridden_by_human");
    expect(payload).not.toHaveProperty("override_response");
  });

  it("404s when decision does not belong to the run", async () => {
    db.enqueue("runs", {
      data: { id: "r1", status: "running", plan_id: "p1", working_dir: "/w" },
      error: null,
    });
    db.enqueue("guardian_decisions", {
      data: { id: "d1", prompt_execution_id: "eOther" },
      error: null,
    });
    db.enqueue("prompt_executions", { data: { id: "eOther", run_id: "rOther" }, error: null });

    const res = await PATCH(
      jsonReq("http://x/api/runs/r1/guardian/decisions/d1", { overrideResponse: "x" }),
      { params: Promise.resolve({ id: "r1", decisionId: "d1" }) },
    );
    expect(res.status).toBe(404);
  });

  it("400s when overrideResponse is empty", async () => {
    const res = await PATCH(
      jsonReq("http://x/api/runs/r1/guardian/decisions/d1", { overrideResponse: "" }),
      { params: Promise.resolve({ id: "r1", decisionId: "d1" }) },
    );
    expect(res.status).toBe(400);
  });
});

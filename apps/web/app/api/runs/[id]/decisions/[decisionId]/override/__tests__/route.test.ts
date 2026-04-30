import { DbStub } from "@/lib/api/__tests__/db-stub";
import * as authModule from "@/lib/api/auth";
import { mutationLimiter } from "@/lib/api/rate-limit";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../route";

function jsonReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/runs/:id/decisions/:decisionId/override", () => {
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

  it("404s when the decision does not belong to the run", async () => {
    db.enqueue("runs", {
      data: { id: "r1", status: "running", plan_id: "p1", working_dir: "/w" },
      error: null,
    });
    db.enqueue("guardian_decisions", {
      data: { id: "d1", prompt_execution_id: "eOther" },
      error: null,
    });
    db.enqueue("prompt_executions", {
      data: { id: "eOther", run_id: "rOther", status: "awaiting_approval" },
      error: null,
    });

    const res = await POST(
      jsonReq("http://x/api/runs/r1/decisions/d1/override", {
        humanResponse: "approved",
        requeuePrompt: false,
      }),
      { params: Promise.resolve({ id: "r1", decisionId: "d1" }) },
    );
    expect(res.status).toBe(404);
  });

  it("records the override without requeue when requeuePrompt=false", async () => {
    db.enqueue("runs", {
      data: { id: "r1", status: "running", plan_id: "p1", working_dir: "/w" },
      error: null,
    });
    db.enqueue("guardian_decisions", {
      data: { id: "d1", prompt_execution_id: "e1" },
      error: null,
    });
    db.enqueue("prompt_executions", {
      data: { id: "e1", run_id: "r1", status: "awaiting_approval" },
      error: null,
    });
    db.enqueue("guardian_decisions", {
      data: { id: "d1", human_override: "yes", reviewed_by_human: true },
      error: null,
    });
    // emitRunEvent: rpc + insert
    db.enqueueRpc("next_event_sequence", { data: 1, error: null });
    db.enqueue("run_events", { data: null, error: null });

    const res = await POST(
      jsonReq("http://x/api/runs/r1/decisions/d1/override", {
        humanResponse: "yes",
        requeuePrompt: false,
      }),
      { params: Promise.resolve({ id: "r1", decisionId: "d1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requeued).toBe(false);

    const updateOp = db.opsFor("guardian_decisions").find((op) => op.op === "update");
    expect(updateOp).toBeDefined();
    const payload = updateOp?.args[0] as { reviewed_by_human?: boolean; human_override?: string };
    expect(payload.reviewed_by_human).toBe(true);
    expect(payload.human_override).toBe("yes");
  });

  it("requeues the prompt when requeuePrompt=true", async () => {
    db.enqueue("runs", {
      data: { id: "r1", status: "running", plan_id: "p1", working_dir: "/w" },
      error: null,
    });
    db.enqueue("guardian_decisions", {
      data: { id: "d1", prompt_execution_id: "e1" },
      error: null,
    });
    db.enqueue("prompt_executions", {
      data: { id: "e1", run_id: "r1", status: "awaiting_approval" },
      error: null,
    });
    db.enqueue("guardian_decisions", {
      data: { id: "d1", human_override: "no", reviewed_by_human: true },
      error: null,
    });
    db.enqueue("prompt_executions", { data: { id: "e1" }, error: null });
    db.enqueueRpc("next_event_sequence", { data: 1, error: null });
    db.enqueue("run_events", { data: null, error: null });

    const res = await POST(
      jsonReq("http://x/api/runs/r1/decisions/d1/override", {
        humanResponse: "no",
        requeuePrompt: true,
      }),
      { params: Promise.resolve({ id: "r1", decisionId: "d1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requeued).toBe(true);
  });

  it("400s when humanResponse is missing", async () => {
    const res = await POST(
      jsonReq("http://x/api/runs/r1/decisions/d1/override", { requeuePrompt: false }),
      { params: Promise.resolve({ id: "r1", decisionId: "d1" }) },
    );
    expect(res.status).toBe(400);
  });
});

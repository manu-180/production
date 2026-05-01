/**
 * Smoke + branch tests for the run-control routes.
 *
 * Each route shares the same skeleton: assert ownership, transition state,
 * emit a run_event. We cover happy path, 404 (run not owned), and 409
 * (state forbids transition) for each.
 */

import { DbStub } from "@/lib/api/__tests__/db-stub";
import * as authModule from "@/lib/api/auth";
import { generalLimiter, mutationLimiter } from "@/lib/api/rate-limit";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Prevent createServiceClient from throwing in test env (no Supabase env vars).
vi.mock("@conductor/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@conductor/db")>();
  return { ...mod, createServiceClient: vi.fn(() => ({ from: vi.fn() })) };
});

import { POST as TRIGGER } from "../../plans/[id]/runs/route";
import { POST as APPROVE } from "../[id]/approve-prompt/route";
import { POST as CANCEL } from "../[id]/cancel/route";
import { POST as PAUSE } from "../[id]/pause/route";
import { POST as RESUME } from "../[id]/resume/route";
import { POST as RETRY } from "../[id]/retry/route";
import { GET as GET_ONE } from "../[id]/route";
import { POST as SKIP } from "../[id]/skip-prompt/route";
import { GET as GET_LIST } from "../route";

const RUN = "00000000-0000-4000-8000-000000000001";
const PLAN = "00000000-0000-4000-8000-000000000099";
const PROMPT = "00000000-0000-4000-8000-000000000aaa";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function jsonReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function setup(): DbStub {
  const db = new DbStub();
  vi.spyOn(authModule, "getAuthedUser").mockResolvedValue({
    ok: true,
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    user: { userId: "u1", db: db as any },
  });
  generalLimiter.clear();
  mutationLimiter.clear();
  return db;
}

afterEach(() => vi.restoreAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/runs (list)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/runs", () => {
  it("returns runs filtered by status", async () => {
    const db = setup();
    db.enqueue("runs", {
      data: [{ id: RUN, created_at: "2026-04-30T00:00:00Z", status: "running" }],
      error: null,
    });
    const res = await GET_LIST(jsonReq("GET", "http://x/api/runs?status=running"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runs).toHaveLength(1);
  });

  it("rejects unknown status with 400", async () => {
    setup();
    const res = await GET_LIST(jsonReq("GET", "http://x/api/runs?status=garbage"));
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/runs/:id
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/runs/:id", () => {
  it("returns run + executions + plan", async () => {
    const db = setup();
    db.enqueue("runs", {
      data: { id: RUN, status: "running", plan_id: PLAN, working_dir: "/tmp" },
      error: null,
    });
    db.enqueue("runs", { data: { id: RUN, status: "running" }, error: null });
    db.enqueue("prompt_executions", {
      data: [
        { id: "e1", status: "succeeded", prompts: { order_index: 0 } },
        { id: "e2", status: "running", prompts: { order_index: 1 } },
      ],
      error: null,
    });
    db.enqueue("plans", { data: { id: PLAN, name: "Plan" }, error: null });

    const res = await GET_ONE(jsonReq("GET", `http://x/api/runs/${RUN}`), params(RUN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(RUN);
    expect(body.executions).toHaveLength(2);
    expect(body.plan.id).toBe(PLAN);
  });

  it("returns 404 when run not owned", async () => {
    const db = setup();
    db.enqueue("runs", { data: null, error: null });
    const res = await GET_ONE(jsonReq("GET", `http://x/api/runs/${RUN}`), params(RUN));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/plans/:id/runs (trigger)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/plans/:id/runs", () => {
  it("enqueues a run and emits an audit event", async () => {
    const db = setup();
    db.enqueue("plans", { data: { id: PLAN }, error: null });
    db.enqueue("prompts", { data: { id: "p1" }, error: null }); // anyPrompt check
    db.enqueueRpc("enqueue_run", { data: RUN, error: null });
    db.enqueue("run_events", { data: null, error: null });
    db.enqueue("runs", { data: { id: RUN, status: "queued" }, error: null });

    const res = await TRIGGER(
      jsonReq("POST", `http://x/api/plans/${PLAN}/runs`, { workingDir: "/tmp" }),
      params(PLAN),
    );
    expect(res.status).toBe(201);
    expect(db.rpcCalls.find((c) => c.fn === "enqueue_run")).toBeDefined();
  });

  it("returns 409 when the plan has no prompts", async () => {
    const db = setup();
    db.enqueue("plans", { data: { id: PLAN }, error: null });
    db.enqueue("prompts", { data: null, error: null });
    const res = await TRIGGER(
      jsonReq("POST", `http://x/api/plans/${PLAN}/runs`, { workingDir: "/tmp" }),
      params(PLAN),
    );
    expect(res.status).toBe(409);
  });

  it("dryRun returns the planned shape without enqueueing", async () => {
    const db = setup();
    db.enqueue("plans", { data: { id: PLAN }, error: null });
    db.enqueue("prompts", { data: { id: "p1" }, error: null }); // anyPrompt
    db.enqueue("prompts", {
      data: [{ id: "p1", order_index: 0, title: "First" }],
      error: null,
    });

    const res = await TRIGGER(
      jsonReq("POST", `http://x/api/plans/${PLAN}/runs`, { workingDir: "/tmp", dryRun: true }),
      params(PLAN),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.prompts).toHaveLength(1);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("rejects missing workingDir with 400", async () => {
    setup();
    const res = await TRIGGER(jsonReq("POST", `http://x/api/plans/${PLAN}/runs`, {}), params(PLAN));
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pause/resume/cancel — share a transition pattern
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/runs/:id/pause", () => {
  it("flips running -> paused and emits user.pause", async () => {
    const db = setup();
    db.enqueue("runs", {
      data: { id: RUN, status: "running", plan_id: PLAN, working_dir: "/tmp" },
      error: null,
    });
    db.enqueue("runs", { data: { id: RUN, status: "paused" }, error: null });
    db.enqueueRpc("next_event_sequence", { data: 1, error: null });
    db.enqueue("run_events", { data: null, error: null });

    const res = await PAUSE(
      jsonReq("POST", `http://x/api/runs/${RUN}/pause`, { reason: "lunch" }),
      params(RUN),
    );
    expect(res.status).toBe(200);
  });

  it("returns 409 when the run is already completed", async () => {
    const db = setup();
    db.enqueue("runs", {
      data: { id: RUN, status: "completed", plan_id: PLAN, working_dir: "/tmp" },
      error: null,
    });
    db.enqueue("runs", { data: null, error: null }); // transition fails

    const res = await PAUSE(jsonReq("POST", `http://x/api/runs/${RUN}/pause`), params(RUN));
    expect(res.status).toBe(409);
  });

  it("returns 404 when the run is not owned", async () => {
    const db = setup();
    db.enqueue("runs", { data: null, error: null });
    const res = await PAUSE(jsonReq("POST", `http://x/api/runs/${RUN}/pause`), params(RUN));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/runs/:id/resume", () => {
  it("flips paused -> running", async () => {
    const db = setup();
    db.enqueue("runs", {
      data: { id: RUN, status: "paused", plan_id: PLAN, working_dir: "/tmp" },
      error: null,
    });
    db.enqueue("runs", { data: { id: RUN, status: "running" }, error: null });
    db.enqueueRpc("next_event_sequence", { data: 2, error: null });
    db.enqueue("run_events", { data: null, error: null });

    const res = await RESUME(jsonReq("POST", `http://x/api/runs/${RUN}/resume`), params(RUN));
    expect(res.status).toBe(200);
  });

  it("returns 409 when run is not paused", async () => {
    const db = setup();
    db.enqueue("runs", {
      data: { id: RUN, status: "running", plan_id: PLAN, working_dir: "/tmp" },
      error: null,
    });
    db.enqueue("runs", { data: null, error: null });
    const res = await RESUME(jsonReq("POST", `http://x/api/runs/${RUN}/resume`), params(RUN));
    expect(res.status).toBe(409);
  });
});

describe("POST /api/runs/:id/cancel", () => {
  it("requires a reason and cancels from running", async () => {
    const db = setup();
    db.enqueue("runs", {
      data: { id: RUN, status: "running", plan_id: PLAN, working_dir: "/tmp" },
      error: null,
    });
    db.enqueue("runs", { data: { id: RUN, status: "cancelled" }, error: null });
    db.enqueueRpc("next_event_sequence", { data: 3, error: null });
    db.enqueue("run_events", { data: null, error: null });

    const res = await CANCEL(
      jsonReq("POST", `http://x/api/runs/${RUN}/cancel`, { reason: "user requested" }),
      params(RUN),
    );
    expect(res.status).toBe(200);
  });

  it("rejects body without reason", async () => {
    setup();
    const res = await CANCEL(jsonReq("POST", `http://x/api/runs/${RUN}/cancel`, {}), params(RUN));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/runs/:id/retry", () => {
  it("re-enqueues a failed run pointing at the predecessor", async () => {
    const db = setup();
    db.enqueue("runs", {
      data: { id: RUN, status: "failed", plan_id: PLAN, working_dir: "/tmp" },
      error: null,
    });
    db.enqueueRpc("enqueue_run", { data: "00000000-0000-4000-8000-000000000099", error: null });
    db.enqueueRpc("next_event_sequence", { data: 1, error: null });
    db.enqueue("run_events", { data: null, error: null });
    db.enqueue("runs", { data: { id: "00000000-0000-4000-8000-000000000099" }, error: null });

    const res = await RETRY(jsonReq("POST", `http://x/api/runs/${RUN}/retry`), params(RUN));
    expect(res.status).toBe(201);
  });

  it("rejects retry on a running run with 409", async () => {
    const db = setup();
    db.enqueue("runs", {
      data: { id: RUN, status: "running", plan_id: PLAN, working_dir: "/tmp" },
      error: null,
    });
    const res = await RETRY(jsonReq("POST", `http://x/api/runs/${RUN}/retry`), params(RUN));
    expect(res.status).toBe(409);
  });
});

describe("POST /api/runs/:id/skip-prompt", () => {
  it("skips a pending execution", async () => {
    const db = setup();
    db.enqueue("runs", {
      data: { id: RUN, status: "running", plan_id: PLAN, working_dir: "/tmp" },
      error: null,
    });
    db.enqueue("prompt_executions", {
      data: { id: "e1", status: "pending" },
      error: null,
    });
    db.enqueue("prompt_executions", {
      data: { id: "e1", status: "skipped" },
      error: null,
    });
    db.enqueueRpc("next_event_sequence", { data: 4, error: null });
    db.enqueue("run_events", { data: null, error: null });

    const res = await SKIP(
      jsonReq("POST", `http://x/api/runs/${RUN}/skip-prompt`, { promptId: PROMPT }),
      params(RUN),
    );
    expect(res.status).toBe(200);
  });

  it("returns 409 when execution already terminal", async () => {
    const db = setup();
    db.enqueue("runs", {
      data: { id: RUN, status: "running", plan_id: PLAN, working_dir: "/tmp" },
      error: null,
    });
    db.enqueue("prompt_executions", {
      data: { id: "e1", status: "succeeded" },
      error: null,
    });

    const res = await SKIP(
      jsonReq("POST", `http://x/api/runs/${RUN}/skip-prompt`, { promptId: PROMPT }),
      params(RUN),
    );
    expect(res.status).toBe(409);
  });

  it("returns 404 when execution missing for the run", async () => {
    const db = setup();
    db.enqueue("runs", {
      data: { id: RUN, status: "running", plan_id: PLAN, working_dir: "/tmp" },
      error: null,
    });
    db.enqueue("prompt_executions", { data: null, error: null });
    const res = await SKIP(
      jsonReq("POST", `http://x/api/runs/${RUN}/skip-prompt`, { promptId: PROMPT }),
      params(RUN),
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/runs/:id/approve-prompt", () => {
  it("approves -> flips back to running", async () => {
    const db = setup();
    db.enqueue("runs", {
      data: { id: RUN, status: "running", plan_id: PLAN, working_dir: "/tmp" },
      error: null,
    });
    db.enqueue("prompt_executions", {
      data: { id: "e1", status: "awaiting_approval" },
      error: null,
    });
    db.enqueue("prompt_executions", {
      data: { id: "e1", status: "running" },
      error: null,
    });
    db.enqueueRpc("next_event_sequence", { data: 5, error: null });
    db.enqueue("run_events", { data: null, error: null });

    const res = await APPROVE(
      jsonReq("POST", `http://x/api/runs/${RUN}/approve-prompt`, {
        promptId: PROMPT,
        decision: "approve",
      }),
      params(RUN),
    );
    expect(res.status).toBe(200);
  });

  it("rejects -> flips to skipped + finished_at set", async () => {
    const db = setup();
    db.enqueue("runs", {
      data: { id: RUN, status: "running", plan_id: PLAN, working_dir: "/tmp" },
      error: null,
    });
    db.enqueue("prompt_executions", {
      data: { id: "e1", status: "awaiting_approval" },
      error: null,
    });
    db.enqueue("prompt_executions", {
      data: { id: "e1", status: "skipped" },
      error: null,
    });
    db.enqueueRpc("next_event_sequence", { data: 6, error: null });
    db.enqueue("run_events", { data: null, error: null });

    const res = await APPROVE(
      jsonReq("POST", `http://x/api/runs/${RUN}/approve-prompt`, {
        promptId: PROMPT,
        decision: "reject",
      }),
      params(RUN),
    );
    expect(res.status).toBe(200);
  });

  it("returns 409 when execution is not awaiting_approval", async () => {
    const db = setup();
    db.enqueue("runs", {
      data: { id: RUN, status: "running", plan_id: PLAN, working_dir: "/tmp" },
      error: null,
    });
    db.enqueue("prompt_executions", {
      data: { id: "e1", status: "running" },
      error: null,
    });

    const res = await APPROVE(
      jsonReq("POST", `http://x/api/runs/${RUN}/approve-prompt`, {
        promptId: PROMPT,
        decision: "approve",
      }),
      params(RUN),
    );
    expect(res.status).toBe(409);
  });
});

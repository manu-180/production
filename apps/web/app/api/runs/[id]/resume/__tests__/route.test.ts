import { DbStub } from "@/lib/api/__tests__/db-stub";
import * as authModule from "@/lib/api/auth";
import { mutationLimiter } from "@/lib/api/rate-limit";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as RESUME } from "../route";

const RUN = "00000000-0000-4000-8000-000000000001";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function jsonReq(): NextRequest {
  return new NextRequest("http://x/api/runs/x/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
}

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

describe("POST /api/runs/:id/resume", () => {
  it("hot path: fresh heartbeat → flips paused → running", async () => {
    // assertRunOwned
    db.enqueue("runs", {
      data: {
        id: RUN,
        status: "paused",
        plan_id: "p1",
        working_dir: "/tmp",
        last_succeeded_prompt_index: 2,
      },
      error: null,
    });
    // heartbeat lookup → fresh (10s ago)
    db.enqueue("runs", {
      data: {
        last_heartbeat_at: new Date(Date.now() - 10_000).toISOString(),
        last_succeeded_prompt_index: 2,
        resume_session_id: null,
      },
      error: null,
    });
    // transitionRunStatus update
    db.enqueue("runs", { data: { id: RUN, status: "running" }, error: null });
    // emitRunEvent: rpc + insert
    db.enqueueRpc("next_event_sequence", { data: 1, error: null });
    db.enqueue("run_events", { data: null, error: null });

    const res = await RESUME(jsonReq(), params(RUN));
    expect(res.status).toBe(200);

    const runsStubs = db.stubs.filter((s) => s.table === "runs");
    const updateOp = runsStubs.flatMap((s) => s.ops).find((o) => o.op === "update");
    const updatePayload = updateOp?.args[0] as Record<string, unknown> | undefined;
    expect(updatePayload?.["status"]).toBe("running");
    // hot path must NOT touch resume_from_index
    expect(updatePayload).not.toHaveProperty("resume_from_index");
  });

  it("cold path: stale heartbeat → flips to queued AND sets resume_from_index", async () => {
    db.enqueue("runs", {
      data: {
        id: RUN,
        status: "paused",
        plan_id: "p1",
        working_dir: "/tmp",
        last_succeeded_prompt_index: 2,
      },
      error: null,
    });
    // 5 minutes old → cold
    db.enqueue("runs", {
      data: {
        last_heartbeat_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        last_succeeded_prompt_index: 2,
        resume_session_id: "sess-old",
      },
      error: null,
    });
    db.enqueue("runs", { data: { id: RUN, status: "queued" }, error: null });
    db.enqueueRpc("next_event_sequence", { data: 1, error: null });
    db.enqueue("run_events", { data: null, error: null });

    const res = await RESUME(jsonReq(), params(RUN));
    expect(res.status).toBe(200);

    const runsStubs = db.stubs.filter((s) => s.table === "runs");
    const updateOp = runsStubs.flatMap((s) => s.ops).find((o) => o.op === "update");
    const updatePayload = updateOp?.args[0] as Record<string, unknown> | undefined;
    expect(updatePayload?.["status"]).toBe("queued");
    expect(updatePayload?.["resume_from_index"]).toBe(3);
    expect(updatePayload?.["resume_session_id"]).toBe("sess-old");
  });

  it("cold path with no prior progress: resume_from_index=0", async () => {
    db.enqueue("runs", {
      data: {
        id: RUN,
        status: "paused",
        plan_id: "p1",
        working_dir: "/tmp",
        last_succeeded_prompt_index: null,
      },
      error: null,
    });
    db.enqueue("runs", {
      data: {
        last_heartbeat_at: null, // never heartbeated
        last_succeeded_prompt_index: null,
        resume_session_id: null,
      },
      error: null,
    });
    db.enqueue("runs", { data: { id: RUN, status: "queued" }, error: null });
    db.enqueueRpc("next_event_sequence", { data: 1, error: null });
    db.enqueue("run_events", { data: null, error: null });

    const res = await RESUME(jsonReq(), params(RUN));
    expect(res.status).toBe(200);

    const runsStubs = db.stubs.filter((s) => s.table === "runs");
    const updateOp = runsStubs.flatMap((s) => s.ops).find((o) => o.op === "update");
    const updatePayload = updateOp?.args[0] as Record<string, unknown> | undefined;
    expect(updatePayload?.["resume_from_index"]).toBe(0);
  });

  it("rejects when run is not in paused status", async () => {
    db.enqueue("runs", {
      data: {
        id: RUN,
        status: "running",
        plan_id: "p1",
        working_dir: "/tmp",
        last_succeeded_prompt_index: 0,
      },
      error: null,
    });

    const res = await RESUME(jsonReq(), params(RUN));
    expect(res.status).toBe(409);
  });

  it("returns 404 when run is not owned by user", async () => {
    db.enqueue("runs", { data: null, error: null });

    const res = await RESUME(jsonReq(), params(RUN));
    expect(res.status).toBe(404);
  });
});

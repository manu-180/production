import { DbStub } from "@/lib/api/__tests__/db-stub";
import * as authModule from "@/lib/api/auth";
import { mutationLimiter } from "@/lib/api/rate-limit";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@conductor/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@conductor/db")>();
  return { ...mod, createServiceClient: vi.fn(() => ({ from: vi.fn() })) };
});

import { POST as RETRY } from "../route";

const RUN = "00000000-0000-4000-8000-000000000001";
const NEW_RUN = "00000000-0000-4000-8000-000000000002";
const PLAN = "00000000-0000-4000-8000-000000000099";
const PROMPT_ID = "00000000-0000-4000-8000-000000000aaa";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function jsonReq(url: string): NextRequest {
  return new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" } });
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

describe("POST /api/runs/:id/retry", () => {
  it("sin query usa from=resume por default y pasa resume params al enqueue", async () => {
    db.enqueue("runs", {
      data: {
        id: RUN,
        status: "failed",
        plan_id: PLAN,
        working_dir: "/tmp",
        last_succeeded_prompt_index: 3,
      },
      error: null,
    });
    db.enqueue("prompts", { data: { id: PROMPT_ID }, error: null });
    db.enqueue("prompt_executions", { data: { claude_session_id: "sess-abc" }, error: null });
    db.enqueueRpc("enqueue_run", { data: NEW_RUN, error: null });
    db.enqueueRpc("next_event_sequence", { data: 1, error: null });
    db.enqueue("run_events", { data: null, error: null });
    db.enqueue("runs", { data: { id: NEW_RUN }, error: null });

    const res = await RETRY(jsonReq(`http://x/api/runs/${RUN}/retry`), params(RUN));
    expect(res.status).toBe(201);

    const enqueueCall = db.rpcCalls.find((c) => c.fn === "enqueue_run");
    expect(enqueueCall?.args).toMatchObject({
      p_resume_from_index: 4,
      p_resume_session_id: "sess-abc",
    });

    const body = await res.json();
    expect(body._meta.mode).toBe("resume");
    expect(body._meta.resumeFromIndex).toBe(4);
  });

  it("?from=start ignora last_succeeded y enqueue con resume_from_index=null", async () => {
    db.enqueue("runs", {
      data: {
        id: RUN,
        status: "failed",
        plan_id: PLAN,
        working_dir: "/tmp",
        last_succeeded_prompt_index: 3,
      },
      error: null,
    });
    db.enqueueRpc("enqueue_run", { data: NEW_RUN, error: null });
    db.enqueueRpc("next_event_sequence", { data: 1, error: null });
    db.enqueue("run_events", { data: null, error: null });
    db.enqueue("runs", { data: { id: NEW_RUN }, error: null });

    const res = await RETRY(jsonReq(`http://x/api/runs/${RUN}/retry?from=start`), params(RUN));
    expect(res.status).toBe(201);

    const enqueueCall = db.rpcCalls.find((c) => c.fn === "enqueue_run");
    expect(enqueueCall?.args).toMatchObject({ p_resume_from_index: null });

    const body = await res.json();
    expect(body._meta.mode).toBe("start");
  });

  it("?from=resume con last_succeeded_prompt_index=null arranca de cero", async () => {
    db.enqueue("runs", {
      data: {
        id: RUN,
        status: "failed",
        plan_id: PLAN,
        working_dir: "/tmp",
        last_succeeded_prompt_index: null,
      },
      error: null,
    });
    db.enqueueRpc("enqueue_run", { data: NEW_RUN, error: null });
    db.enqueueRpc("next_event_sequence", { data: 1, error: null });
    db.enqueue("run_events", { data: null, error: null });
    db.enqueue("runs", { data: { id: NEW_RUN }, error: null });

    const res = await RETRY(jsonReq(`http://x/api/runs/${RUN}/retry`), params(RUN));
    expect(res.status).toBe(201);

    const enqueueCall = db.rpcCalls.find((c) => c.fn === "enqueue_run");
    expect(enqueueCall?.args).toMatchObject({ p_resume_from_index: null });

    const body = await res.json();
    expect(body._meta.mode).toBe("start");
    expect(body._meta.resumeFromIndex).toBeNull();
  });

  it("responde 409 si el run está en status running", async () => {
    db.enqueue("runs", {
      data: {
        id: RUN,
        status: "running",
        plan_id: PLAN,
        working_dir: "/tmp",
        last_succeeded_prompt_index: null,
      },
      error: null,
    });

    const res = await RETRY(jsonReq(`http://x/api/runs/${RUN}/retry`), params(RUN));
    expect(res.status).toBe(409);
  });

  it("evento user.retry incluye mode y resumeFromIndex en el payload", async () => {
    db.enqueue("runs", {
      data: {
        id: RUN,
        status: "failed",
        plan_id: PLAN,
        working_dir: "/tmp",
        last_succeeded_prompt_index: 2,
      },
      error: null,
    });
    db.enqueue("prompts", { data: { id: PROMPT_ID }, error: null });
    db.enqueue("prompt_executions", { data: { claude_session_id: "sess-xyz" }, error: null });
    db.enqueueRpc("enqueue_run", { data: NEW_RUN, error: null });
    db.enqueueRpc("next_event_sequence", { data: 1, error: null });
    db.enqueue("run_events", { data: null, error: null });
    db.enqueue("runs", { data: { id: NEW_RUN }, error: null });

    await RETRY(jsonReq(`http://x/api/runs/${RUN}/retry`), params(RUN));

    const insertOp = db.opsFor("run_events").find((o) => o.op === "insert");
    // biome-ignore lint/suspicious/noExplicitAny: test assertion on stub payload
    const evtPayload = (insertOp?.args[0] as any)?.payload;
    expect(evtPayload?.mode).toBe("resume");
    expect(evtPayload?.resumeFromIndex).toBe(3);
  });

  it("?from=invalid retorna 400", async () => {
    const res = await RETRY(jsonReq(`http://x/api/runs/${RUN}/retry?from=invalid`), params(RUN));
    expect(res.status).toBe(400);
  });
});

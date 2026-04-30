import { DbStub } from "@/lib/api/__tests__/db-stub";
import * as authModule from "@/lib/api/auth";
import { generalLimiter, mutationLimiter } from "@/lib/api/rate-limit";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function jsonReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// Valid UUID v4 strings (version=4, variant in 8/9/a/b). Zod 4's
// z.string().uuid() enforces the RFC 4122 v4 layout, not just hex shape.
const PLAN_ID = "00000000-0000-4000-8000-000000000099";
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000099";

describe("POST /api/plans/:id/prompts/reorder", () => {
  let db: DbStub;
  beforeEach(() => {
    db = new DbStub();
    vi.spyOn(authModule, "getAuthedUser").mockResolvedValue({
      ok: true,
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      user: { userId: "u1", db: db as any },
    });
    generalLimiter.clear();
    mutationLimiter.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("reorders 3 prompts in two phases (stage + commit)", async () => {
    db.enqueue("plans", { data: { id: PLAN_ID }, error: null });
    db.enqueue("prompts", {
      data: [{ id: A }, { id: B }, { id: C }],
      error: null,
    });
    // 3 stage updates + 3 commit updates = 6 update calls
    for (let i = 0; i < 6; i++) {
      db.enqueue("prompts", { data: null, error: null });
    }

    const res = await POST(
      jsonReq("POST", `http://x/api/plans/${PLAN_ID}/prompts/reorder`, {
        ordered: [C, A, B],
      }),
      params(PLAN_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Sanity: 6 updates issued
    const updates = db.opsFor("prompts").filter((op) => op.op === "update");
    expect(updates.length).toBe(6);

    // Final commit phase issues order_index 0,1,2 in declared sequence
    const last3 = updates.slice(3).map((u) => (u.args[0] as { order_index: number }).order_index);
    expect(last3).toEqual([0, 1, 2]);
  });

  it("rejects when ordered list misses prompts of the plan", async () => {
    db.enqueue("plans", { data: { id: PLAN_ID }, error: null });
    db.enqueue("prompts", {
      data: [{ id: A }, { id: B }, { id: C }],
      error: null,
    });
    const res = await POST(
      jsonReq("POST", `http://x/api/plans/${PLAN_ID}/prompts/reorder`, {
        ordered: [A, B], // missing C
      }),
      params(PLAN_ID),
    );
    expect(res.status).toBe(400);
  });

  it("rejects when ordered contains an unknown id", async () => {
    db.enqueue("plans", { data: { id: PLAN_ID }, error: null });
    db.enqueue("prompts", {
      data: [{ id: A }, { id: B }],
      error: null,
    });
    const res = await POST(
      jsonReq("POST", `http://x/api/plans/${PLAN_ID}/prompts/reorder`, {
        ordered: [A, UNKNOWN_ID],
      }),
      params(PLAN_ID),
    );
    expect(res.status).toBe(400);
  });

  it("rejects duplicates in ordered list", async () => {
    db.enqueue("plans", { data: { id: PLAN_ID }, error: null });
    db.enqueue("prompts", { data: [{ id: A }, { id: B }], error: null });
    const res = await POST(
      jsonReq("POST", `http://x/api/plans/${PLAN_ID}/prompts/reorder`, {
        ordered: [A, A],
      }),
      params(PLAN_ID),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when plan missing", async () => {
    db.enqueue("plans", { data: null, error: null });
    const res = await POST(
      jsonReq("POST", `http://x/api/plans/${PLAN_ID}/prompts/reorder`, {
        ordered: [A],
      }),
      params(PLAN_ID),
    );
    expect(res.status).toBe(404);
  });
});

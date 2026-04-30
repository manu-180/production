import { DbStub } from "@/lib/api/__tests__/db-stub";
import * as authModule from "@/lib/api/auth";
import { generalLimiter, mutationLimiter } from "@/lib/api/rate-limit";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as PROMPT_GET, POST as PROMPT_POST } from "../route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function jsonReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("/api/plans/:id/prompts", () => {
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

  it("GET returns prompts ordered", async () => {
    db.enqueue("plans", { data: { id: "p1" }, error: null });
    db.enqueue("prompts", {
      data: [
        { id: "a", order_index: 0 },
        { id: "b", order_index: 1 },
      ],
      error: null,
    });
    const res = await PROMPT_GET(jsonReq("GET", "http://x/api/plans/p1/prompts"), params("p1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompts).toHaveLength(2);
  });

  it("GET returns 404 when plan missing", async () => {
    db.enqueue("plans", { data: null, error: null });
    const res = await PROMPT_GET(jsonReq("GET", "http://x/api/plans/p1/prompts"), params("p1"));
    expect(res.status).toBe(404);
  });

  it("POST appends a prompt with computed content_hash and next order_index", async () => {
    db.enqueue("plans", { data: { id: "p1" }, error: null });
    db.enqueue("prompts", { data: { order_index: 4 }, error: null }); // for nextOrderIndex
    db.enqueue("prompts", {
      data: { id: "pr1", order_index: 5, content: "hello" },
      error: null,
    });

    const res = await PROMPT_POST(
      jsonReq("POST", "http://x/api/plans/p1/prompts", { content: "hello" }),
      params("p1"),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("pr1");
    // The insert payload should include the next order_index (4 + 1 = 5)
    const insertOp = db.opsFor("prompts").find((op) => op.op === "insert");
    expect(insertOp).toBeDefined();
    const payload = insertOp?.args[0] as { order_index: number; content_hash: string };
    expect(payload.order_index).toBe(5);
    expect(payload.content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("POST honors explicit order_index", async () => {
    db.enqueue("plans", { data: { id: "p1" }, error: null });
    db.enqueue("prompts", {
      data: { id: "pr1", order_index: 2, content: "hi" },
      error: null,
    });

    const res = await PROMPT_POST(
      jsonReq("POST", "http://x/api/plans/p1/prompts", { content: "hi", order_index: 2 }),
      params("p1"),
    );
    expect(res.status).toBe(201);
  });

  it("POST rejects empty content with 400", async () => {
    const res = await PROMPT_POST(
      jsonReq("POST", "http://x/api/plans/p1/prompts", { content: "" }),
      params("p1"),
    );
    expect(res.status).toBe(400);
  });

  it("POST returns 404 when plan missing", async () => {
    db.enqueue("plans", { data: null, error: null });
    const res = await PROMPT_POST(
      jsonReq("POST", "http://x/api/plans/p1/prompts", { content: "x" }),
      params("p1"),
    );
    expect(res.status).toBe(404);
  });
});

import { DbStub } from "@/lib/api/__tests__/db-stub";
import * as authModule from "@/lib/api/auth";
import { generalLimiter, mutationLimiter } from "@/lib/api/rate-limit";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, PATCH } from "../route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function jsonReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("/api/plans/:id", () => {
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

  it("GET returns plan + prompts", async () => {
    db.enqueue("plans", {
      data: { id: "p1", name: "X", user_id: "u1" },
      error: null,
    });
    db.enqueue("prompts", {
      data: [{ id: "pr1", plan_id: "p1", order_index: 0 }],
      error: null,
    });

    const res = await GET(jsonReq("GET", "http://x/api/plans/p1"), params("p1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("p1");
    expect(body.prompts).toHaveLength(1);
  });

  it("GET returns 404 when plan missing", async () => {
    db.enqueue("plans", { data: null, error: null });
    const res = await GET(jsonReq("GET", "http://x/api/plans/p1"), params("p1"));
    expect(res.status).toBe(404);
  });

  it("PATCH updates the plan and returns it", async () => {
    db.enqueue("plans", {
      data: { id: "p1", name: "renamed", user_id: "u1" },
      error: null,
    });
    const res = await PATCH(
      jsonReq("PATCH", "http://x/api/plans/p1", { name: "renamed" }),
      params("p1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("renamed");
  });

  it("PATCH rejects empty body with 400", async () => {
    const res = await PATCH(jsonReq("PATCH", "http://x/api/plans/p1", {}), params("p1"));
    expect(res.status).toBe(400);
  });

  it("PATCH returns 404 when plan missing", async () => {
    db.enqueue("plans", { data: null, error: null });
    const res = await PATCH(
      jsonReq("PATCH", "http://x/api/plans/p1", { name: "renamed" }),
      params("p1"),
    );
    expect(res.status).toBe(404);
  });

  it("DELETE removes the plan and returns 204", async () => {
    db.enqueue("plans", { data: { id: "p1" }, error: null }); // ownership check
    db.enqueue("plans", { data: null, error: null }); // delete
    const res = await DELETE(jsonReq("DELETE", "http://x/api/plans/p1"), params("p1"));
    expect(res.status).toBe(204);
  });

  it("DELETE returns 404 when plan missing", async () => {
    db.enqueue("plans", { data: null, error: null });
    const res = await DELETE(jsonReq("DELETE", "http://x/api/plans/p1"), params("p1"));
    expect(res.status).toBe(404);
  });

  it("DELETE translates FK violation to 409 conflict", async () => {
    db.enqueue("plans", { data: { id: "p1" }, error: null });
    db.enqueue("plans", {
      data: null,
      error: { code: "23503", message: "fk violation" },
    });
    const res = await DELETE(jsonReq("DELETE", "http://x/api/plans/p1"), params("p1"));
    expect(res.status).toBe(409);
  });
});

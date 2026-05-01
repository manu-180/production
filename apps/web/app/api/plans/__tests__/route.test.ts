import { DbStub } from "@/lib/api/__tests__/db-stub";
import * as authModule from "@/lib/api/auth";
import { generalLimiter, mutationLimiter } from "@/lib/api/rate-limit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Prevent createServiceClient from throwing in test env (no Supabase env vars).
vi.mock("@conductor/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@conductor/db")>();
  return { ...mod, createServiceClient: vi.fn(() => ({ from: vi.fn() })) };
});

import { NextRequest } from "next/server";

import { GET, POST } from "../route";

function jsonReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/plans", () => {
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

  it("returns plans + nextCursor when full page", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      created_at: `2026-04-30T00:00:${String(i).padStart(2, "0")}Z`,
      name: `Plan ${i}`,
    }));
    db.enqueue("plans", { data: rows, error: null });

    const res = await GET(jsonReq("GET", "http://x/api/plans?limit=20"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plans).toHaveLength(20);
    expect(typeof body.nextCursor).toBe("string");
  });

  it("omits nextCursor when fewer rows than limit", async () => {
    db.enqueue("plans", { data: [], error: null });
    const res = await GET(jsonReq("GET", "http://x/api/plans?limit=20"));
    const body = await res.json();
    expect(body.nextCursor).toBeUndefined();
  });

  it("rejects unsupported query (limit > 100) with 400", async () => {
    const res = await GET(jsonReq("GET", "http://x/api/plans?limit=999"));
    expect(res.status).toBe(400);
  });

  it("propagates DB errors as 500", async () => {
    db.enqueue("plans", { data: null, error: { code: "PGRST", message: "boom" } });
    const res = await GET(jsonReq("GET", "http://x/api/plans"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("internal");
  });
});

describe("POST /api/plans", () => {
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

  it("creates a plan without prompts -> 201", async () => {
    db.enqueue("plans", {
      data: { id: "p1", name: "Test", user_id: "u1" },
      error: null,
    });
    const res = await POST(jsonReq("POST", "http://x/api/plans", { name: "Test" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("p1");
    expect(body.prompts).toEqual([]);
  });

  it("creates a plan with prompts -> 201 and inserts both", async () => {
    db.enqueue("plans", {
      data: { id: "p1", name: "Test", user_id: "u1" },
      error: null,
    });
    db.enqueue("prompts", {
      data: [
        { id: "pr1", plan_id: "p1", order_index: 0, content: "first" },
        { id: "pr2", plan_id: "p1", order_index: 1, content: "second" },
      ],
      error: null,
    });

    const res = await POST(
      jsonReq("POST", "http://x/api/plans", {
        name: "Test",
        prompts: [{ content: "first" }, { content: "second" }],
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.prompts).toHaveLength(2);
    const promptInsertOp = db.opsFor("prompts").find((op) => op.op === "insert");
    expect(promptInsertOp).toBeDefined();
    const payload = promptInsertOp?.args[0] as Array<{ content_hash?: string }>;
    expect(payload[0]?.content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects invalid name with 400", async () => {
    const res = await POST(jsonReq("POST", "http://x/api/plans", { name: "" }));
    expect(res.status).toBe(400);
  });

  it("rolls back the plan when prompt insert fails", async () => {
    db.enqueue("plans", {
      data: { id: "p1", name: "Test", user_id: "u1" },
      error: null,
    });
    db.enqueue("prompts", {
      data: null,
      error: { code: "23505", message: "duplicate order_index" },
    });
    db.enqueue("plans", { data: null, error: null }); // delete()

    const res = await POST(
      jsonReq("POST", "http://x/api/plans", {
        name: "Test",
        prompts: [{ content: "first" }],
      }),
    );
    expect(res.status).toBe(500);
    // The cleanup delete must have been issued
    expect(db.allOps().some((op) => op.op === "delete")).toBe(true);
  });
});

import { DbStub } from "@/lib/api/__tests__/db-stub";
import * as authModule from "@/lib/api/auth";
import { generalLimiter, mutationLimiter } from "@/lib/api/rate-limit";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Prevent createServiceClient from throwing in test env (no Supabase env vars).
vi.mock("@conductor/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@conductor/db")>();
  return { ...mod, createServiceClient: vi.fn(() => ({ from: vi.fn() })) };
});

import { GET, PATCH } from "../route";

function jsonReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/settings", () => {
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

  it("returns defaults when no settings row exists", async () => {
    db.enqueue("settings", { data: null, error: null });
    const res = await GET(jsonReq("GET", "http://x/api/settings"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user_id).toBe("u1");
    expect(body.theme).toBe("system");
    expect(body.default_model).toBe("sonnet");
  });

  it("returns the persisted row when one exists", async () => {
    db.enqueue("settings", {
      data: {
        user_id: "u1",
        theme: "dark",
        auto_approve_low_risk: true,
        default_model: "opus",
        git_auto_commit: false,
        git_auto_push: false,
        notification_channels: { slack: "x" },
        updated_at: "2026-04-30T00:00:00Z",
      },
      error: null,
    });
    const res = await GET(jsonReq("GET", "http://x/api/settings"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.theme).toBe("dark");
    expect(body.default_model).toBe("opus");
  });
});

describe("PATCH /api/settings", () => {
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

  it("upserts the merged row and returns it", async () => {
    db.enqueue("settings", { data: null, error: null }); // existing read
    db.enqueue("settings", {
      data: {
        user_id: "u1",
        theme: "dark",
        auto_approve_low_risk: false,
        default_model: "sonnet",
        git_auto_commit: true,
        git_auto_push: false,
        notification_channels: {},
      },
      error: null,
    });

    const res = await PATCH(jsonReq("PATCH", "http://x/api/settings", { theme: "dark" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.theme).toBe("dark");

    const upsertOp = db.opsFor("settings").find((op) => op.op === "upsert");
    expect(upsertOp).toBeDefined();
    const payload = upsertOp?.args[0] as { user_id?: string; theme?: string };
    expect(payload.user_id).toBe("u1");
    expect(payload.theme).toBe("dark");
  });

  it("rejects an empty body with 400", async () => {
    const res = await PATCH(jsonReq("PATCH", "http://x/api/settings", {}));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid theme with 400", async () => {
    const res = await PATCH(jsonReq("PATCH", "http://x/api/settings", { theme: "neon" }));
    expect(res.status).toBe(400);
  });
});

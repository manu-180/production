import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as authModule from "../auth";
import { defineRoute } from "../handler";
import { generalLimiter, mutationLimiter } from "../rate-limit";
import { TRACE_ID_HEADER } from "../trace";

const fakeUser = { userId: "user-1", db: {} as never };

function makeReq(
  url: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): NextRequest {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new NextRequest(url, {
    method: init?.method ?? "GET",
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    headers,
  });
}

describe("defineRoute — auth", () => {
  beforeEach(() => {
    vi.spyOn(authModule, "getAuthedUser").mockResolvedValue({ ok: true, user: fakeUser });
    generalLimiter.clear();
    mutationLimiter.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects when auth fails with 401", async () => {
    vi.spyOn(authModule, "getAuthedUser").mockResolvedValue({
      ok: false,
      reason: "unauthorized",
    });
    const route = defineRoute({}, async () => NextResponse.json({}));
    const res = await route(makeReq("http://x/api/foo"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("rejects with 403 when reason is 'forbidden'", async () => {
    vi.spyOn(authModule, "getAuthedUser").mockResolvedValue({ ok: false, reason: "forbidden" });
    const route = defineRoute({}, async () => NextResponse.json({}));
    const res = await route(makeReq("http://x/api/foo"));
    expect(res.status).toBe(403);
  });

  it("skips auth when auth: false", async () => {
    const spy = vi.spyOn(authModule, "getAuthedUser");
    const route = defineRoute({ auth: false, rateLimit: "none" }, async () =>
      NextResponse.json({ ok: true }),
    );
    const res = await route(makeReq("http://x/api/health"));
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("defineRoute — traceId", () => {
  beforeEach(() => {
    vi.spyOn(authModule, "getAuthedUser").mockResolvedValue({ ok: true, user: fakeUser });
    generalLimiter.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("propagates inbound x-trace-id to response", async () => {
    const incoming = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const route = defineRoute({}, async ({ traceId }) => NextResponse.json({ traceId }));
    const res = await route(
      makeReq("http://x/api/foo", { headers: { [TRACE_ID_HEADER]: incoming } }),
    );
    expect(res.headers.get(TRACE_ID_HEADER)).toBe(incoming);
    const body = await res.json();
    expect(body.traceId).toBe(incoming);
  });

  it("mints a fresh traceId when header is missing", async () => {
    const route = defineRoute({}, async ({ traceId }) => NextResponse.json({ traceId }));
    const res = await route(makeReq("http://x/api/foo"));
    const body = await res.json();
    expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get(TRACE_ID_HEADER)).toBe(body.traceId);
  });
});

describe("defineRoute — body validation", () => {
  beforeEach(() => {
    vi.spyOn(authModule, "getAuthedUser").mockResolvedValue({ ok: true, user: fakeUser });
    mutationLimiter.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("rejects invalid body with 400 + zod issues", async () => {
    const schema = z.object({ name: z.string().min(2) });
    const route = defineRoute({ rateLimit: "mutation", bodySchema: schema }, async ({ body }) =>
      NextResponse.json(body),
    );
    const res = await route(makeReq("http://x/api/foo", { method: "POST", body: { name: "x" } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation");
    expect(body.details).toBeInstanceOf(Array);
  });

  it("passes valid body through to handler", async () => {
    const schema = z.object({ name: z.string().min(2) });
    const route = defineRoute({ rateLimit: "mutation", bodySchema: schema }, async ({ body }) =>
      NextResponse.json({ got: body }),
    );
    const res = await route(makeReq("http://x/api/foo", { method: "POST", body: { name: "abc" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.got).toEqual({ name: "abc" });
  });

  it("treats missing/malformed JSON as null body and triggers validation", async () => {
    const schema = z.object({ name: z.string() });
    const route = defineRoute({ rateLimit: "mutation", bodySchema: schema }, async () =>
      NextResponse.json({}),
    );
    const res = await route(
      new NextRequest("http://x/api/foo", {
        method: "POST",
        body: "not-json",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("defineRoute — query validation", () => {
  beforeEach(() => {
    vi.spyOn(authModule, "getAuthedUser").mockResolvedValue({ ok: true, user: fakeUser });
    generalLimiter.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("coerces and validates query params", async () => {
    const schema = z.object({ limit: z.coerce.number().int().min(1).max(50) });
    const route = defineRoute({ querySchema: schema }, async ({ query }) =>
      NextResponse.json({ q: query }),
    );
    const ok = await route(makeReq("http://x/api/foo?limit=20"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).q).toEqual({ limit: 20 });

    const bad = await route(makeReq("http://x/api/foo?limit=999"));
    expect(bad.status).toBe(400);
  });
});

describe("defineRoute — rate limit", () => {
  beforeEach(() => {
    vi.spyOn(authModule, "getAuthedUser").mockResolvedValue({ ok: true, user: fakeUser });
    mutationLimiter.clear();
    generalLimiter.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns 429 with Retry-After once the per-user cap is hit", async () => {
    const route = defineRoute({ rateLimit: "mutation" }, async () =>
      NextResponse.json({ ok: true }),
    );
    // mutation cap is 30/min; hammer 30, the 31st must fail.
    for (let i = 0; i < 30; i++) {
      const res = await route(makeReq("http://x/api/foo", { method: "POST" }));
      expect(res.status).toBe(200);
    }
    const blocked = await route(makeReq("http://x/api/foo", { method: "POST" }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toMatch(/^\d+$/);
    const body = await blocked.json();
    expect(body.error).toBe("rate_limited");
    expect(body.details).toMatchObject({ retryAfterSec: expect.any(Number) });
  });
});

describe("defineRoute — error handling", () => {
  beforeEach(() => {
    vi.spyOn(authModule, "getAuthedUser").mockResolvedValue({ ok: true, user: fakeUser });
    generalLimiter.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("converts thrown errors into a 500 with traceId and never leaks the stack in prod", async () => {
    const route = defineRoute({}, async () => {
      throw new Error("boom");
    });
    // process.env.NODE_ENV is typed as readonly in modern @types/node; mutate via Record cast.
    const env = process.env as Record<string, string | undefined>;
    const prev = env["NODE_ENV"];
    env["NODE_ENV"] = "production";
    try {
      const res = await route(makeReq("http://x/api/foo"));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("internal");
      expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.details).toBeUndefined();
    } finally {
      env["NODE_ENV"] = prev;
    }
  });
});

describe("defineRoute — params", () => {
  beforeEach(() => {
    vi.spyOn(authModule, "getAuthedUser").mockResolvedValue({ ok: true, user: fakeUser });
    generalLimiter.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("resolves Next.js dynamic params (Promise) before passing to the handler", async () => {
    const route = defineRoute<undefined, undefined, { id: string }>({}, async ({ params }) =>
      NextResponse.json({ id: params.id }),
    );
    const res = await route(makeReq("http://x/api/plans/abc"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: "abc" });
  });
});

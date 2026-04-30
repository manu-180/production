import { DbStub } from "@/lib/api/__tests__/db-stub";
import * as authModule from "@/lib/api/auth";
import { generalLimiter } from "@/lib/api/rate-limit";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isRepoMock: vi.fn(),
  getDiffMock: vi.fn(),
  getNumstatMock: vi.fn(),
}));
const { isRepoMock, getDiffMock, getNumstatMock } = mocks;

vi.mock("@conductor/core", () => ({
  GitManager: class FakeGitManager {
    isRepo = mocks.isRepoMock;
    getDiff = mocks.getDiffMock;
    getNumstat = mocks.getNumstatMock;
  },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { GET } from "../route";

function req(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

describe("GET /api/runs/:id/diff/:promptId", () => {
  let db: DbStub;
  beforeEach(() => {
    db = new DbStub();
    vi.spyOn(authModule, "getAuthedUser").mockResolvedValue({
      ok: true,
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      user: { userId: "u1", db: db as any },
    });
    generalLimiter.clear();
    isRepoMock.mockResolvedValue(true);
    getDiffMock.mockResolvedValue("--- a/x\n+++ b/x\n@@ ... @@\n+added\n");
    getNumstatMock.mockResolvedValue([{ added: 3, removed: 1, path: "x.ts" }]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("404s when the run does not exist", async () => {
    db.enqueue("runs", { data: null, error: null });
    const res = await GET(req("http://x/api/runs/r1/diff/pr1"), {
      params: Promise.resolve({ id: "r1", promptId: "pr1" }),
    });
    expect(res.status).toBe(404);
  });

  it("404s when the execution has no checkpoint", async () => {
    db.enqueue("runs", {
      data: { id: "r1", status: "running", plan_id: "p1", working_dir: "/w" },
      error: null,
    });
    db.enqueue("prompt_executions", {
      data: { id: "e1", prompt_id: "pr1", checkpoint_sha: null },
      error: null,
    });
    const res = await GET(req("http://x/api/runs/r1/diff/pr1"), {
      params: Promise.resolve({ id: "r1", promptId: "pr1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns diff + stats for a first prompt (parent = HEAD~1)", async () => {
    db.enqueue("runs", {
      data: { id: "r1", status: "running", plan_id: "p1", working_dir: "/w" },
      error: null,
    });
    db.enqueue("prompt_executions", {
      data: { id: "e1", prompt_id: "pr1", checkpoint_sha: "abc1234" },
      error: null,
    });
    // resolveParentSha: target prompt has order_index 0 → returns null
    db.enqueue("prompts", { data: { order_index: 0, plan_id: "p1" }, error: null });

    const res = await GET(req("http://x/api/runs/r1/diff/pr1"), {
      params: Promise.resolve({ id: "r1", promptId: "pr1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fromSha).toBe("abc1234~1");
    expect(body.toSha).toBe("abc1234");
    expect(body.diff).toMatch(/added/);
    expect(body.stats).toEqual({ filesChanged: 1, additions: 3, deletions: 1 });
  });
});

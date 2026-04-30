import { DbStub } from "@/lib/api/__tests__/db-stub";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbStub = vi.hoisted(() => ({
  current: null as DbStub | null,
}));

vi.mock("@conductor/db", () => ({
  createServiceClient: () => dbStub.current,
}));

const execMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: (
    cmd: string,
    args: string[],
    opts: unknown,
    cb: (err: Error | null, out: { stdout: string; stderr: string }) => void,
  ) => execMocks.execFile(cmd, args, opts, cb),
}));

import { GET } from "../route";

function req(): NextRequest {
  return new NextRequest("http://x/api/system/health", { method: "GET" });
}

describe("GET /api/system/health", () => {
  beforeEach(() => {
    dbStub.current = new DbStub();
    execMocks.execFile.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("reports ok across the board when everything responds", async () => {
    const db = dbStub.current as DbStub;
    db.enqueue("plans", { data: [], error: null });
    db.enqueue("worker_instances", {
      data: { last_seen_at: new Date().toISOString() },
      error: null,
    });
    execMocks.execFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, out: { stdout: string; stderr: string }) => void,
      ) => {
        cb(null, { stdout: "claude 1.4.2\n", stderr: "" });
      },
    );

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.web).toBe("ok");
    expect(body.db).toBe("ok");
    expect(body.worker).toBe("ok");
    expect(body.claudeCli.installed).toBe(true);
    expect(body.claudeCli.version).toBe("1.4.2");
  });

  it("marks db down when the read fails", async () => {
    const db = dbStub.current as DbStub;
    db.enqueue("plans", { data: null, error: { code: "PGRST", message: "boom" } });
    db.enqueue("worker_instances", { data: null, error: null });
    execMocks.execFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, out: { stdout: string; stderr: string }) => void,
      ) => {
        cb(new Error("not installed"), { stdout: "", stderr: "" });
      },
    );

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.db).toBe("down");
    expect(body.worker).toBe("offline");
    expect(body.claudeCli.installed).toBe(false);
  });

  it("marks worker offline when the heartbeat is stale", async () => {
    const db = dbStub.current as DbStub;
    db.enqueue("plans", { data: [], error: null });
    db.enqueue("worker_instances", {
      data: { last_seen_at: new Date(Date.now() - 5 * 60_000).toISOString() },
      error: null,
    });
    execMocks.execFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, out: { stdout: string; stderr: string }) => void,
      ) => {
        cb(null, { stdout: "claude 1.0.0\n", stderr: "" });
      },
    );

    const res = await GET(req());
    const body = await res.json();
    expect(body.worker).toBe("offline");
  });
});

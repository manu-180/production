import { describe, expect, it } from "vitest";
import {
  type ResumableExecution,
  type ResumableRun,
  type ResumeDbClient,
  loadResumableState,
  markRunResumable,
  resumeRun,
} from "../resumability.js";

interface FakeOpts {
  run?: ResumableRun | null;
  runError?: unknown;
  executions?: ResumableExecution[];
  execError?: unknown;
  updateError?: unknown;
  throwOnRun?: boolean;
  throwOnExec?: boolean;
}

interface UpdateRecord {
  table: string;
  data: Record<string, unknown>;
  filters: { col: string; val: unknown }[];
}

function makeDb(opts: FakeOpts = {}): { db: ResumeDbClient; updates: UpdateRecord[] } {
  const updates: UpdateRecord[] = [];

  const dbObj = {
    from(table: string) {
      return {
        select(_cols?: string) {
          const chain = {
            eq(_c: string, _v: unknown) {
              return chain;
            },
            order(_c: string, _o?: { ascending?: boolean }) {
              return chain;
            },
            single() {
              if (table === "runs") {
                if (opts.throwOnRun) return Promise.reject(new Error("run threw"));
                return Promise.resolve({ data: opts.run ?? null, error: opts.runError ?? null });
              }
              return Promise.resolve({ data: null, error: null });
            },
            then(resolve: (v: { data: unknown; error: unknown }) => void, reject: (e: unknown) => void) {
              if (table === "prompt_executions") {
                if (opts.throwOnExec) {
                  reject(new Error("exec threw"));
                  return;
                }
                resolve({
                  data: opts.execError ? null : opts.executions ?? [],
                  error: opts.execError ?? null,
                });
                return;
              }
              resolve({ data: null, error: null });
            },
          };
          return chain;
        },
        update(data: Record<string, unknown>) {
          const filters: { col: string; val: unknown }[] = [];
          const chain = {
            eq(c: string, v: unknown) {
              filters.push({ col: c, val: v });
              return chain;
            },
            then(resolve: (v: { data: unknown; error: unknown }) => void) {
              updates.push({ table, data, filters });
              resolve({ data: null, error: opts.updateError ?? null });
            },
          };
          return chain;
        },
      };
    },
  };

  return { db: dbObj as unknown as ResumeDbClient, updates };
}

describe("loadResumableState", () => {
  it("returns null when run not found", async () => {
    const { db } = makeDb({ run: null });
    const r = await loadResumableState("nope", db);
    expect(r).toBeNull();
  });

  it("returns null when run query errors", async () => {
    const { db } = makeDb({ runError: { message: "x" } });
    const r = await loadResumableState("nope", db);
    expect(r).toBeNull();
  });

  it("survives run query throwing", async () => {
    const { db } = makeDb({ throwOnRun: true });
    const r = await loadResumableState("any", db);
    expect(r).toBeNull();
  });

  it("computes lastSuccessfulIndex=-1 with no executions", async () => {
    const run: ResumableRun = { id: "r1", status: "paused", current_prompt_index: 0 };
    const { db } = makeDb({ run, executions: [] });
    const state = await loadResumableState("r1", db);
    expect(state).not.toBeNull();
    if (!state) return;
    expect(state.lastSuccessfulIndex).toBe(-1);
    expect(state.nextAttempt).toBe(1);
    expect(state.inFlightPromptId).toBeUndefined();
  });

  it("counts succeeded prompts and reports next attempt for in-flight prompt", async () => {
    const run: ResumableRun = { id: "r1", status: "paused", current_prompt_index: 2 };
    const executions: ResumableExecution[] = [
      { id: "e1", prompt_id: "p1", attempt: 1, status: "succeeded", checkpoint_sha: "abc" },
      { id: "e2", prompt_id: "p2", attempt: 1, status: "succeeded", checkpoint_sha: "def" },
      { id: "e3", prompt_id: "p3", attempt: 2, status: "failed" },
    ];
    const { db } = makeDb({ run, executions });
    const state = await loadResumableState("r1", db);
    expect(state).not.toBeNull();
    if (!state) return;
    expect(state.lastSuccessfulIndex).toBe(1);
    expect(state.inFlightPromptId).toBe("p3");
    expect(state.nextAttempt).toBe(3);
  });

  it("aggregates multiple attempts per prompt correctly", async () => {
    const run: ResumableRun = { id: "r1", status: "paused" };
    const executions: ResumableExecution[] = [
      { id: "e1", prompt_id: "p1", attempt: 1, status: "failed" },
      { id: "e2", prompt_id: "p1", attempt: 2, status: "failed" },
      { id: "e3", prompt_id: "p1", attempt: 3, status: "succeeded", checkpoint_sha: "x" },
      { id: "e4", prompt_id: "p2", attempt: 1, status: "running" },
    ];
    const { db } = makeDb({ run, executions });
    const state = await loadResumableState("r1", db);
    expect(state).not.toBeNull();
    if (!state) return;
    expect(state.lastSuccessfulIndex).toBe(0);
    expect(state.inFlightPromptId).toBe("p2");
    expect(state.nextAttempt).toBe(2);
  });

  it("treats exec query error as empty exec list", async () => {
    const run: ResumableRun = { id: "r1", status: "paused" };
    const { db } = makeDb({ run, execError: { message: "x" } });
    const state = await loadResumableState("r1", db);
    expect(state).not.toBeNull();
    if (!state) return;
    expect(state.executions).toEqual([]);
    expect(state.lastSuccessfulIndex).toBe(-1);
  });

  it("survives exec query throw", async () => {
    const run: ResumableRun = { id: "r1", status: "paused" };
    const { db } = makeDb({ run, throwOnExec: true });
    const state = await loadResumableState("r1", db);
    expect(state).not.toBeNull();
    if (!state) return;
    expect(state.executions).toEqual([]);
  });
});

describe("markRunResumable", () => {
  it("flips status=paused with reason", async () => {
    const { db, updates } = makeDb();
    const ok = await markRunResumable("r1", db, "test_reason");
    expect(ok).toBe(true);
    expect(updates.length).toBe(1);
    const u = updates[0];
    expect(u).toBeDefined();
    if (u) {
      expect(u.data["status"]).toBe("paused");
      expect(u.data["cancellation_reason"]).toBe("test_reason");
    }
  });

  it("returns false on DB error", async () => {
    const { db } = makeDb({ updateError: { message: "x" } });
    const ok = await markRunResumable("r1", db, "x");
    expect(ok).toBe(false);
  });
});

describe("resumeRun", () => {
  it("flips status=queued with status=paused CAS guard", async () => {
    const { db, updates } = makeDb();
    const ok = await resumeRun("r1", db);
    expect(ok).toBe(true);
    expect(updates.length).toBe(1);
    const u = updates[0];
    expect(u).toBeDefined();
    if (u) {
      expect(u.data["status"]).toBe("queued");
      expect(u.data["cancellation_reason"]).toBeNull();
      const hasStatusFilter = u.filters.some((f) => f.col === "status" && f.val === "paused");
      expect(hasStatusFilter).toBe(true);
    }
  });

  it("returns false on DB error", async () => {
    const { db } = makeDb({ updateError: { message: "x" } });
    const ok = await resumeRun("r1", db);
    expect(ok).toBe(false);
  });
});

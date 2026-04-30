import { describe, expect, it, vi } from "vitest";
import {
  type RecoveryDbClient,
  type RecoveryRunRow,
  recoverOrphanedRuns,
} from "../crash-recovery.js";

interface FakeDbOptions {
  rows?: RecoveryRunRow[];
  selectError?: unknown;
  updateError?: unknown;
  throwOnSelect?: boolean;
  throwOnUpdate?: boolean;
}

function makeDb(opts: FakeDbOptions = {}): {
  db: RecoveryDbClient;
  selectFilters: { col: string; val: unknown }[];
  orFilters: string[];
  updates: { id: string; data: Record<string, unknown> }[];
} {
  const selectFilters: { col: string; val: unknown }[] = [];
  const orFilters: string[] = [];
  const updates: { id: string; data: Record<string, unknown> }[] = [];

  const db: RecoveryDbClient = {
    from(_table: string) {
      return {
        select(_cols?: string) {
          const chain: {
            eq: (c: string, v: unknown) => typeof chain;
            lt: (c: string, v: unknown) => typeof chain;
            or: (f: string) => typeof chain;
            then: (
              resolve: (v: { data: RecoveryRunRow[] | null; error: unknown }) => void,
              reject: (e: unknown) => void,
            ) => void;
          } = {
            eq(c, v) {
              selectFilters.push({ col: c, val: v });
              return chain;
            },
            lt(c, v) {
              selectFilters.push({ col: c, val: v });
              return chain;
            },
            or(f) {
              orFilters.push(f);
              return chain;
            },
            then(resolve, reject) {
              if (opts.throwOnSelect) {
                reject(new Error("select threw"));
                return;
              }
              resolve({
                data: opts.selectError ? null : opts.rows ?? [],
                error: opts.selectError ?? null,
              });
            },
          };
          return chain as unknown as ReturnType<RecoveryDbClient["from"]>["select"] extends (
            ...a: unknown[]
          ) => infer R
            ? R
            : never;
        },
        update(data: Record<string, unknown>) {
          let capturedId = "";
          const chain: {
            eq: (c: string, v: unknown) => typeof chain;
            then: (
              resolve: (v: { data: unknown; error: unknown }) => void,
              reject: (e: unknown) => void,
            ) => void;
          } = {
            eq(c, v) {
              if (c === "id" && typeof v === "string") capturedId = v;
              return chain;
            },
            then(resolve, reject) {
              if (opts.throwOnUpdate) {
                reject(new Error("update threw"));
                return;
              }
              updates.push({ id: capturedId, data });
              resolve({ data: null, error: opts.updateError ?? null });
            },
          };
          return chain as unknown as ReturnType<RecoveryDbClient["from"]>["update"] extends (
            ...a: unknown[]
          ) => infer R
            ? R
            : never;
        },
      } as unknown as ReturnType<RecoveryDbClient["from"]>;
    },
  };

  return { db, selectFilters, orFilters, updates };
}

describe("recoverOrphanedRuns", () => {
  it("returns no recoveries when DB has no orphans", async () => {
    const { db } = makeDb({ rows: [] });
    const result = await recoverOrphanedRuns(db);
    expect(result.recovered).toEqual([]);
    expect(result.errored).toEqual([]);
  });

  it("issues an OR filter on null/stale heartbeat", async () => {
    const { db, orFilters } = makeDb({ rows: [] });
    await recoverOrphanedRuns(db, { now: () => 1_700_000_000_000, staleMs: 60_000 });
    expect(orFilters.length).toBe(1);
    const filter = orFilters[0];
    expect(filter).toBeDefined();
    if (filter) {
      expect(filter).toContain("last_heartbeat_at.is.null");
      expect(filter).toContain("last_heartbeat_at.lt.");
    }
  });

  it("recovers each orphan and returns its id", async () => {
    const rows: RecoveryRunRow[] = [
      { id: "r1", status: "running", last_heartbeat_at: null },
      { id: "r2", status: "running", last_heartbeat_at: "2020-01-01T00:00:00Z" },
    ];
    const { db, updates } = makeDb({ rows });
    const result = await recoverOrphanedRuns(db);
    expect(result.recovered.sort()).toEqual(["r1", "r2"]);
    expect(updates.length).toBe(2);
    const u0 = updates[0];
    expect(u0).toBeDefined();
    if (u0) {
      expect(u0.data["status"]).toBe("paused");
      expect(u0.data["cancellation_reason"]).toBe("worker_crash_recovery");
    }
  });

  it("logs and returns empty when select fails", async () => {
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const { db } = makeDb({ selectError: { message: "bad" } });
    const result = await recoverOrphanedRuns(db, { logger });
    expect(result.recovered).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  it("survives select throwing", async () => {
    const { db } = makeDb({ throwOnSelect: true });
    const result = await recoverOrphanedRuns(db);
    expect(result.recovered).toEqual([]);
    expect(result.errored).toEqual([]);
  });

  it("collects errored ids when update returns error", async () => {
    const rows: RecoveryRunRow[] = [{ id: "r1", status: "running" }];
    const { db } = makeDb({ rows, updateError: { message: "nope" } });
    const result = await recoverOrphanedRuns(db);
    expect(result.recovered).toEqual([]);
    expect(result.errored).toEqual(["r1"]);
  });

  it("collects errored ids when update throws", async () => {
    const rows: RecoveryRunRow[] = [{ id: "r1", status: "running" }];
    const { db } = makeDb({ rows, throwOnUpdate: true });
    const result = await recoverOrphanedRuns(db);
    expect(result.recovered).toEqual([]);
    expect(result.errored).toEqual(["r1"]);
  });

  it("ignores rows with empty/missing id", async () => {
    const rows = [{ id: "", status: "running" }, { status: "running" }] as RecoveryRunRow[];
    const { db, updates } = makeDb({ rows });
    const result = await recoverOrphanedRuns(db);
    expect(result.recovered).toEqual([]);
    expect(updates.length).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "../../orchestrator/orchestrator.js";
import { HealthMonitor } from "../health-monitor.js";

interface UpdateCall {
  table: string;
  data: Record<string, unknown>;
  id: string;
}

function makeFakeDb(opts: { error?: unknown; throwOnce?: boolean } = {}): {
  db: DbClient;
  calls: UpdateCall[];
} {
  const calls: UpdateCall[] = [];
  let throwArmed = opts.throwOnce ?? false;

  const db = {
    from(table: string) {
      return {
        select(): never {
          throw new Error("not used");
        },
        insert(): never {
          throw new Error("not used");
        },
        update(data: Record<string, unknown>) {
          const u = {
            eq(_col: string, val: string) {
              const promise = (async (): Promise<{ error: unknown }> => {
                if (throwArmed) {
                  throwArmed = false;
                  throw new Error("simulated DB throw");
                }
                calls.push({ table, data, id: val });
                return { error: opts.error ?? null };
              })();
              const chain = promise as unknown as {
                eq: (c: string, v: string) => unknown;
                select: () => unknown;
                single: () => unknown;
              };
              chain.eq = u.eq;
              chain.select = (): never => {
                throw new Error("nope");
              };
              chain.single = (): never => {
                throw new Error("nope");
              };
              return chain;
            },
          };
          return u;
        },
      };
    },
  } as unknown as DbClient;

  return { db, calls };
}

describe("HealthMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits an immediate heartbeat on start()", async () => {
    const { db, calls } = makeFakeDb();
    const hm = new HealthMonitor(db, { intervalMs: 10_000, nowIso: () => "2026-01-01T00:00:00Z" });
    hm.start("run-1");
    await hm.heartbeatNow();
    await hm.stop();
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const first = calls[0];
    expect(first).toBeDefined();
    if (first) {
      expect(first.table).toBe("runs");
      expect(first.id).toBe("run-1");
      expect(first.data["last_heartbeat_at"]).toBe("2026-01-01T00:00:00Z");
    }
  });

  it("ticks every intervalMs", async () => {
    const { db, calls } = makeFakeDb();
    const hm = new HealthMonitor(db, { intervalMs: 1000, nowIso: () => "t" });
    hm.start("run-x");
    await Promise.resolve();
    const initial = calls.length;
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    await hm.stop();
    expect(calls.length).toBeGreaterThanOrEqual(initial + 2);
  });

  it("stop() prevents further ticks", async () => {
    const { db, calls } = makeFakeDb();
    const hm = new HealthMonitor(db, { intervalMs: 500, nowIso: () => "t" });
    hm.start("r");
    await Promise.resolve();
    await hm.stop();
    const before = calls.length;
    vi.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(calls.length).toBe(before);
  });

  it("never throws when DB returns error", async () => {
    const { db } = makeFakeDb({ error: { message: "boom" } });
    const hm = new HealthMonitor(db, { intervalMs: 1000, nowIso: () => "t" });
    hm.start("r");
    await expect(hm.heartbeatNow()).resolves.toBeUndefined();
    await hm.stop();
  });

  it("never throws when DB layer throws", async () => {
    const { db } = makeFakeDb({ throwOnce: true });
    const hm = new HealthMonitor(db, { intervalMs: 1000, nowIso: () => "t" });
    hm.start("r");
    await expect(hm.heartbeatNow()).resolves.toBeUndefined();
    await hm.stop();
  });

  it("start() while already running is a no-op", async () => {
    const { db } = makeFakeDb();
    const hm = new HealthMonitor(db, { intervalMs: 10_000 });
    hm.start("a");
    expect(hm.isRunning()).toBe(true);
    hm.start("b"); // should NOT switch
    expect(hm.isRunning()).toBe(true);
    await hm.stop();
    expect(hm.isRunning()).toBe(false);
  });

  it("stop() is idempotent", async () => {
    const { db } = makeFakeDb();
    const hm = new HealthMonitor(db, { intervalMs: 1000 });
    hm.start("r");
    await hm.stop();
    await expect(hm.stop()).resolves.toBeUndefined();
  });
});

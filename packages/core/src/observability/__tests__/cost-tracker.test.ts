import { describe, expect, it } from "vitest";
import type { DbClient, DbListResult } from "../../guardian/audit-log.js";
import { CostTracker } from "../cost-tracker.js";

// ─────────────────────────────────────────────────────────────────────────────
// Stub helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal DbClient stub that returns `rows` for any list query.
 * We use `as unknown as DbClient` to avoid the biome `noThenProperty` lint
 * rule, which fires when `then` appears as a shorthand property key.
 */
function makeDb(rows: Record<string, unknown>[]): DbClient {
  const listResult: DbListResult = { data: rows, error: null };

  const table = {
    insert() {
      return this;
    },
    update() {
      return this;
    },
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in() {
      return this;
    },
    order() {
      return this;
    },
    single() {
      return Promise.resolve({ data: null, error: null });
    },
    // biome-ignore lint/suspicious/noThenProperty: required to satisfy DbTable thenable interface
    then(
      resolve?: ((v: DbListResult) => unknown) | null,
      _reject?: ((e: unknown) => unknown) | null,
    ) {
      return Promise.resolve(listResult).then(resolve ?? undefined);
    },
  };

  return { from: () => table } as unknown as DbClient;
}

function makeErrorDb(message: string): DbClient {
  const listResult: DbListResult = { data: null, error: { message } };

  const table = {
    insert() {
      return this;
    },
    update() {
      return this;
    },
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in() {
      return this;
    },
    order() {
      return this;
    },
    single() {
      return Promise.resolve({ data: null, error: { message } });
    },
    // biome-ignore lint/suspicious/noThenProperty: required to satisfy DbTable thenable interface
    then(
      resolve?: ((v: DbListResult) => unknown) | null,
      _reject?: ((e: unknown) => unknown) | null,
    ) {
      return Promise.resolve(listResult).then(resolve ?? undefined);
    },
  };

  return { from: () => table } as unknown as DbClient;
}

function makeThrowingDb(): DbClient {
  const err = new Error("connection refused");
  const table = {
    insert() {
      return this;
    },
    update() {
      return this;
    },
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in() {
      return this;
    },
    order() {
      return this;
    },
    single() {
      return Promise.reject(err);
    },
    // biome-ignore lint/suspicious/noThenProperty: required to satisfy DbTable thenable interface
    then(
      _resolve?: ((v: DbListResult) => unknown) | null,
      reject?: ((e: unknown) => unknown) | null,
    ) {
      return Promise.reject(err).then(undefined, reject ?? undefined);
    },
  };

  return { from: () => table } as unknown as DbClient;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers for current-month ISO strings
// ─────────────────────────────────────────────────────────────────────────────

function currentMonthPrefix(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function dateInCurrentMonth(day: number): string {
  return `${currentMonthPrefix()}-${String(day).padStart(2, "0")}T00:00:00Z`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("CostTracker.getCurrentMonthCost", () => {
  it("returns zeros and correct month string when there are no runs", async () => {
    const db = makeDb([]);
    const tracker = new CostTracker(db);
    const result = await tracker.getCurrentMonthCost("user-1");

    expect(result.month).toBe(currentMonthPrefix());
    expect(result.totalCostUsd).toBe(0);
    expect(result.runCount).toBe(0);
  });

  it("sums up total_cost_usd for runs in the current month", async () => {
    const rows = [
      { user_id: "user-1", total_cost_usd: 0.05, created_at: dateInCurrentMonth(2) },
      { user_id: "user-1", total_cost_usd: 0.1, created_at: dateInCurrentMonth(5) },
    ];
    const db = makeDb(rows);
    const tracker = new CostTracker(db);
    const result = await tracker.getCurrentMonthCost("user-1");

    expect(result.totalCostUsd).toBeCloseTo(0.15);
    expect(result.runCount).toBe(2);
    expect(result.month).toBe(currentMonthPrefix());
  });

  it("handles numeric string cost values", async () => {
    const rows = [
      { user_id: "user-1", total_cost_usd: "0.25", created_at: dateInCurrentMonth(10) },
    ];
    const db = makeDb(rows);
    const tracker = new CostTracker(db);
    const result = await tracker.getCurrentMonthCost("user-1");

    expect(result.totalCostUsd).toBeCloseTo(0.25);
    expect(result.runCount).toBe(1);
  });

  it("returns zeros on DB error instead of throwing", async () => {
    const db = makeErrorDb("permission denied");
    const tracker = new CostTracker(db);
    const result = await tracker.getCurrentMonthCost("user-1");

    expect(result.totalCostUsd).toBe(0);
    expect(result.runCount).toBe(0);
    expect(result.deltaPercent).toBeNull();
  });

  it("returns zeros on thrown error instead of throwing", async () => {
    const db = makeThrowingDb();
    const tracker = new CostTracker(db);
    const result = await tracker.getCurrentMonthCost("user-1");

    expect(result.totalCostUsd).toBe(0);
    expect(result.runCount).toBe(0);
  });

  it("sets deltaPercent to 0 when both months have zero cost", async () => {
    const db = makeDb([]);
    const tracker = new CostTracker(db);
    const result = await tracker.getCurrentMonthCost("user-1");
    // Both current and prior month are 0 → deltaPercent = 0
    expect(result.deltaPercent).toBe(0);
  });
});

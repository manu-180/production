import { describe, expect, it } from "vitest";
import type { PromptDefinition } from "../../types.js";
import { groupIntoWaves, runWithConcurrencyLimit } from "../wave-grouper.js";

function makePrompt(id: string, order: number, wave: number): PromptDefinition {
  return {
    id,
    order,
    wave,
    filename: `${id}.md`,
    content: "",
    frontmatter: {},
  };
}

describe("groupIntoWaves", () => {
  it("returns empty for empty input", () => {
    expect(groupIntoWaves([])).toEqual([]);
  });

  it("creates one single-prompt wave per prompt when waves are unique", () => {
    const prompts = [makePrompt("a", 0, 1), makePrompt("b", 1, 2), makePrompt("c", 2, 3)];
    const waves = groupIntoWaves(prompts);
    expect(waves).toHaveLength(3);
    expect(waves.map((w) => w.wave)).toEqual([1, 2, 3]);
    expect(waves.every((w) => !w.isParallel)).toBe(true);
    expect(waves.map((w) => w.startIndex)).toEqual([0, 1, 2]);
  });

  it("groups consecutive prompts with the same wave", () => {
    const prompts = [
      makePrompt("setup", 0, 1),
      makePrompt("api", 1, 2),
      makePrompt("kpi", 2, 3),
      makePrompt("line", 3, 3),
      makePrompt("bar", 4, 3),
      makePrompt("typecheck", 5, 4),
    ];
    const waves = groupIntoWaves(prompts);
    expect(waves).toHaveLength(4);
    expect(waves[0]?.prompts.map((p) => p.id)).toEqual(["setup"]);
    expect(waves[1]?.prompts.map((p) => p.id)).toEqual(["api"]);
    expect(waves[2]?.prompts.map((p) => p.id)).toEqual(["kpi", "line", "bar"]);
    expect(waves[2]?.isParallel).toBe(true);
    expect(waves[2]?.startIndex).toBe(2);
    expect(waves[3]?.prompts.map((p) => p.id)).toEqual(["typecheck"]);
  });

  it("does NOT merge non-consecutive same-wave prompts (strict adjacency)", () => {
    // [w=1, w=2, w=1] → three waves, not two. Authors must keep parallel
    // siblings adjacent in the file listing.
    const prompts = [makePrompt("a", 0, 1), makePrompt("b", 1, 2), makePrompt("c", 2, 1)];
    const waves = groupIntoWaves(prompts);
    expect(waves).toHaveLength(3);
    expect(waves.map((w) => w.wave)).toEqual([1, 2, 1]);
  });

  it("flags isParallel correctly for waves of size > 1", () => {
    const prompts = [makePrompt("a", 0, 5), makePrompt("b", 1, 5)];
    const waves = groupIntoWaves(prompts);
    expect(waves).toHaveLength(1);
    expect(waves[0]?.isParallel).toBe(true);
    expect(waves[0]?.prompts).toHaveLength(2);
  });
});

describe("runWithConcurrencyLimit", () => {
  it("returns empty for empty input", async () => {
    const results = await runWithConcurrencyLimit(3, []);
    expect(results).toEqual([]);
  });

  it("runs all tasks and preserves order in results", async () => {
    const tasks = [
      () => Promise.resolve("a"),
      () => Promise.resolve("b"),
      () => Promise.resolve("c"),
    ];
    const results = await runWithConcurrencyLimit(2, tasks);
    expect(results).toHaveLength(3);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("captures rejections without aborting siblings", async () => {
    const tasks = [
      () => Promise.resolve("ok-1"),
      () => Promise.reject(new Error("boom")),
      () => Promise.resolve("ok-3"),
    ];
    const results = await runWithConcurrencyLimit(3, tasks);
    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]?.status).toBe("rejected");
    expect(results[2]?.status).toBe("fulfilled");
  });

  it("respects the concurrency limit (never more than `limit` running)", async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 10 }, () => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Yield once so other workers actually contend.
      await new Promise((r) => setImmediate(r));
      inFlight--;
      return 1;
    });
    await runWithConcurrencyLimit(3, tasks);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // sanity: parallelism actually happened
  });

  it("clamps limit to >= 1", async () => {
    const tasks = [() => Promise.resolve(1), () => Promise.resolve(2)];
    const results = await runWithConcurrencyLimit(0, tasks);
    expect(results).toHaveLength(2);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([1, 2]);
  });
});

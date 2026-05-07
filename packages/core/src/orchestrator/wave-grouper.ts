/**
 * Conductor — Wave Grouper
 *
 * Pure helper that partitions an ordered list of {@link PromptDefinition}s
 * into "waves" — runs of consecutive prompts that share the same `wave`
 * number. The orchestrator executes waves sequentially; prompts inside a
 * single wave run concurrently (subject to a configurable concurrency cap).
 *
 * The grouping rule is intentionally strict: only **consecutive** prompts
 * with matching wave numbers are merged. If the input is `[w=1, w=2, w=1]`
 * we produce three single-element waves, not two. This keeps the contract
 * obvious for plan authors: parallel siblings must sit next to each other
 * after the lex sort that the plan-loader already applies (e.g. `03a-`,
 * `03b-`, `03c-`). It also avoids introducing a hidden dependency reorder
 * that the user did not ask for.
 *
 * Design notes:
 *   - The function does NOT sort — it trusts the caller to have sorted the
 *     prompts by `order` already. (The orchestrator does this via
 *     `[...plan.prompts].sort((a, b) => a.order - b.order)`.)
 *   - Each returned wave preserves the original `order` of its prompts.
 *   - We stamp every wave with the `startIndex` (position of the first
 *     prompt in the input array) so the caller can advance bookkeeping like
 *     `last_succeeded_prompt_index` to a wave boundary without re-scanning.
 */

import type { PromptDefinition } from "../types.js";

export interface PromptWave {
  /** The shared `wave` number — all prompts in `prompts` carry this value. */
  wave: number;
  /** Prompts in this wave, in their original `order`. */
  prompts: PromptDefinition[];
  /**
   * Index of the first prompt of this wave in the input array. Useful for
   * resume bookkeeping (`last_succeeded_prompt_index = startIndex - 1`
   * before this wave starts; `startIndex + prompts.length - 1` after it
   * succeeds).
   */
  startIndex: number;
  /** Convenience flag: `prompts.length > 1`. Identifies parallel waves. */
  isParallel: boolean;
}

/**
 * Partition an ordered list of prompts into waves. See module docstring for
 * the grouping rule.
 *
 * @param prompts - Prompts already sorted by `order` ascending.
 * @returns Waves in execution order. Empty input → empty output.
 */
export function groupIntoWaves(prompts: readonly PromptDefinition[]): PromptWave[] {
  const waves: PromptWave[] = [];
  let current: PromptWave | null = null;

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    if (p === undefined) continue; // satisfy noUncheckedIndexedAccess
    if (current === null || current.wave !== p.wave) {
      if (current !== null) {
        // Finalize the previous wave's isParallel flag now that we know its
        // final size — `prompts.length` is mutated as we push, so we must
        // refresh once we move on.
        current.isParallel = current.prompts.length > 1;
        waves.push(current);
      }
      current = {
        wave: p.wave,
        prompts: [p],
        startIndex: i,
        isParallel: false,
      };
    } else {
      current.prompts.push(p);
    }
  }

  if (current !== null) {
    current.isParallel = current.prompts.length > 1;
    waves.push(current);
  }

  return waves;
}

/**
 * Bounded-concurrency variant of `Promise.allSettled` for use inside a wave.
 *
 * Runs `tasks` with at most `limit` in flight at any moment, preserving the
 * input order of results. Each task is invoked lazily (only when a slot
 * becomes free) so we don't spawn N child processes up front when the cap
 * is smaller than N.
 *
 * Why not `p-limit`? We deliberately keep this dependency-free — the
 * orchestrator already has a strict surface area and adding a runtime
 * dependency for ~30 lines of code isn't worth it.
 *
 * @param limit - Maximum simultaneous tasks. Clamped to `[1, tasks.length]`.
 * @param tasks - Functions returning a Promise. Called at most once each.
 */
export async function runWithConcurrencyLimit<T>(
  limit: number,
  tasks: ReadonlyArray<() => Promise<T>>,
): Promise<PromiseSettledResult<T>[]> {
  const n = tasks.length;
  if (n === 0) return [];
  const cap = Math.max(1, Math.min(limit, n));

  const results: PromiseSettledResult<T>[] = new Array(n);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= n) return;
      const task = tasks[i];
      if (task === undefined) continue;
      try {
        const value = await task();
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let w = 0; w < cap; w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

import type { RealtimeEvent } from "./event-handlers";

type Listener = (ev: RealtimeEvent) => void;
const buckets = new Map<string, Set<Listener>>();

/** Subscribe to events for a specific runId. Returns an unsubscribe fn. */
export function subscribeRunBus(runId: string, listener: Listener): () => void {
  let set = buckets.get(runId);
  if (set === undefined) {
    set = new Set();
    buckets.set(runId, set);
  }
  set.add(listener);
  return () => {
    const s = buckets.get(runId);
    if (s === undefined) return;
    s.delete(listener);
    if (s.size === 0) buckets.delete(runId);
  };
}

/**
 * Fan out a realtime event. Dispatch is microtask-deferred to keep the
 * Supabase callback fast and avoid layout thrash on bursts.
 */
export function publishRunEvent(ev: RealtimeEvent): void {
  queueMicrotask(() => {
    const set = buckets.get(ev.runId);
    if (set === undefined) return;
    for (const fn of set) {
      try {
        fn(ev);
      } catch {
        /* a single bad listener must not break others */
      }
    }
  });
}

/** Test-only — never call from production code. */
export function _resetEventBus(): void {
  buckets.clear();
}

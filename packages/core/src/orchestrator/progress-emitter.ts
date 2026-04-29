import type { RunEvent } from "../types.js";

/**
 * Minimal Supabase-like client interface used by {@link ProgressEmitter}.
 *
 * Defined locally (rather than imported from `@conductor/db`) so the orchestrator
 * does not take a hard dependency on the generated DB types — any client whose
 * `.from(table).insert(row)` returns a `{ error }` shape is acceptable.
 */
export interface SupabaseLikeClient {
  from(table: string): {
    insert(row: Record<string, unknown>): Promise<{ error: unknown }>;
  };
}

/**
 * Emits {@link RunEvent}s to the `run_events` Supabase table on a best-effort basis.
 *
 * Events are inserted with a monotonically-increasing local sequence number so
 * downstream consumers can order them deterministically. DB failures are logged
 * to stderr and swallowed — the orchestrator must never crash because telemetry
 * could not be persisted. The sequence counter advances on failure too, so
 * gaps in the persisted stream remain meaningful (and don't cause sequence
 * collisions on later successful inserts).
 */
export class ProgressEmitter {
  private readonly runId: string;
  private readonly db: SupabaseLikeClient;
  private sequence: number;

  constructor(runId: string, db: SupabaseLikeClient) {
    this.runId = runId;
    this.db = db;
    this.sequence = 0;
  }

  /**
   * Persist a single {@link RunEvent} to the `run_events` table.
   *
   * The sequence number is captured *before* the insert is attempted and is
   * always incremented, even if the insert errors. This guarantees that two
   * concurrent emits never reuse the same sequence value.
   */
  async emit(event: RunEvent): Promise<void> {
    const seq = this.sequence;
    this.sequence += 1;

    try {
      const { error } = await this.db.from("run_events").insert({
        run_id: this.runId,
        event_type: event.type,
        payload: event,
        sequence: seq,
      });

      if (error !== null && error !== undefined) {
        console.error(
          `[ProgressEmitter] failed to persist event '${event.type}' (run=${this.runId}, seq=${seq}):`,
          error,
        );
      }
    } catch (err) {
      console.error(
        `[ProgressEmitter] threw while persisting event '${event.type}' (run=${this.runId}, seq=${seq}):`,
        err,
      );
    }
  }

  /** Returns the next sequence number that will be used by {@link emit}. */
  getSequence(): number {
    return this.sequence;
  }
}

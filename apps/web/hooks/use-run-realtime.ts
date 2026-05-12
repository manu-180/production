"use client";
import { qk } from "@/lib/react-query/keys";
import { channels } from "@/lib/realtime/channels";
import { getBrowserSupabase } from "@/lib/realtime/client";
import { publishRunEvent } from "@/lib/realtime/event-bus";
import {
  type RealtimeEvent,
  type RunDetailCache,
  applyEvent,
  applyExecutionRow,
  applyRunRow,
} from "@/lib/realtime/event-handlers";
import type { PromptExecution, Run } from "@conductor/db";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

/**
 * Subscribes to `run_events` filtered by `run_id`, applies events to the
 * React Query cache via pure handlers, and republishes them on the in-memory
 * event bus so guardian feed / live cursor / confetti can react.
 *
 * Events are batched per animation frame to avoid thrash on bursty updates.
 */
export function useRunRealtime(runId: string): { isLive: boolean } {
  const qc = useQueryClient();
  const [isLive, setIsLive] = useState(false);
  const queueRef = useRef<RealtimeEvent[]>([]);
  const flushScheduledRef = useRef(false);

  useEffect(() => {
    const supabase = getBrowserSupabase();

    const flush = () => {
      flushScheduledRef.current = false;
      const batch = queueRef.current;
      if (batch.length === 0) return;
      queueRef.current = [];

      qc.setQueryData<RunDetailCache | undefined>(qk.runs.detail(runId), (prev) => {
        if (prev === undefined) return prev;
        let next = prev;
        batch.sort((a, b) => a.sequence - b.sequence);
        for (const ev of batch) next = applyEvent(next, ev);
        return next;
      });
      for (const ev of batch) publishRunEvent(ev);
    };

    const enqueue = (ev: RealtimeEvent) => {
      queueRef.current.push(ev);
      if (!flushScheduledRef.current) {
        flushScheduledRef.current = true;
        requestAnimationFrame(flush);
      }
    };

    // Direct table subscriptions: run_event payloads do not carry
    // prompt_execution_id, so prompt-level status changes never make it into
    // the cache via run_events alone. Mirroring the prompt_executions and
    // runs rows directly keeps the UI in sync regardless of event metadata.
    const patchExecution = (row: PromptExecution) => {
      qc.setQueryData<RunDetailCache | undefined>(qk.runs.detail(runId), (prev) =>
        prev === undefined ? prev : applyExecutionRow(prev, row),
      );
    };
    const patchRun = (row: Partial<Run>) => {
      qc.setQueryData<RunDetailCache | undefined>(qk.runs.detail(runId), (prev) =>
        prev === undefined ? prev : applyRunRow(prev, row),
      );
    };

    const eventsChannel = supabase
      .channel(channels.runEvents(runId))
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "run_events",
          filter: `run_id=eq.${runId}`,
        },
        (msg) => {
          const row = msg.new as {
            run_id: string;
            sequence: number;
            event_type: string;
            payload: unknown;
            prompt_execution_id: string | null;
          };
          enqueue({
            runId: row.run_id,
            sequence: row.sequence,
            eventType: row.event_type,
            payload: (row.payload ?? {}) as never,
            promptExecutionId: row.prompt_execution_id,
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "prompt_executions",
          filter: `run_id=eq.${runId}`,
        },
        (msg) => {
          const row = (msg.new ?? msg.old) as PromptExecution | null;
          if (row?.id) patchExecution(row);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "runs",
          filter: `id=eq.${runId}`,
        },
        (msg) => {
          const row = msg.new as Partial<Run> | null;
          if (row) patchRun(row);
        },
      )
      .subscribe((status) => {
        setIsLive(status === "SUBSCRIBED");
      });

    return () => {
      setIsLive(false);
      void supabase.removeChannel(eventsChannel);
    };
  }, [runId, qc]);

  return { isLive };
}

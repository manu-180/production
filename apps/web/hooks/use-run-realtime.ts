"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { qk } from "@/lib/react-query/keys";
import { channels } from "@/lib/realtime/channels";
import { getBrowserSupabase } from "@/lib/realtime/client";
import { publishRunEvent } from "@/lib/realtime/event-bus";
import {
  applyEvent,
  type RealtimeEvent,
  type RunDetailCache,
} from "@/lib/realtime/event-handlers";

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

      qc.setQueryData<RunDetailCache | undefined>(
        qk.runs.detail(runId),
        (prev) => {
          if (prev === undefined) return prev;
          let next = prev;
          batch.sort((a, b) => a.sequence - b.sequence);
          for (const ev of batch) next = applyEvent(next, ev);
          return next;
        },
      );
      for (const ev of batch) publishRunEvent(ev);
    };

    const enqueue = (ev: RealtimeEvent) => {
      queueRef.current.push(ev);
      if (!flushScheduledRef.current) {
        flushScheduledRef.current = true;
        requestAnimationFrame(flush);
      }
    };

    const channel = supabase
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
      .subscribe((status) => {
        setIsLive(status === "SUBSCRIBED");
      });

    return () => {
      setIsLive(false);
      void supabase.removeChannel(channel);
    };
  }, [runId, qc]);

  return { isLive };
}

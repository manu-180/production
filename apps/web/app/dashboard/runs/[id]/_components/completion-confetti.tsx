"use client";
import { useEffect, useRef } from "react";
import { subscribeRunBus } from "@/lib/realtime/event-bus";

export function CompletionConfetti({ runId }: { runId: string }) {
  const firedRef = useRef(false);

  useEffect(() => {
    const off = subscribeRunBus(runId, async (ev) => {
      if (ev.eventType !== "run.completed") return;
      if (firedRef.current) return;
      firedRef.current = true;
      try {
        const { default: confetti } = await import("canvas-confetti");
        confetti({ particleCount: 120, spread: 70, origin: { y: 0.7 } });
        setTimeout(() => {
          confetti({ particleCount: 80, spread: 90, origin: { x: 0.2, y: 0.6 } });
          confetti({ particleCount: 80, spread: 90, origin: { x: 0.8, y: 0.6 } });
        }, 250);
      } catch {
        /* confetti is non-essential */
      }
    });
    return off;
  }, [runId]);

  return null;
}

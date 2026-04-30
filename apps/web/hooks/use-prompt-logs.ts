"use client";
import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { channels } from "@/lib/realtime/channels";
import { getBrowserSupabase } from "@/lib/realtime/client";

export type LogChannel = "stdout" | "stderr" | "tool" | "meta" | "claude";

export interface LogLine {
  id: number;
  sequence: number;
  channel: LogChannel | string;
  content: string;
  promptExecutionId: string;
  createdAt: string;
}

interface ApiChunk {
  id: number;
  channel: string;
  content: string | null;
  created_at: string;
  prompt_execution_id: string;
}

interface ApiResponse {
  chunks: ApiChunk[];
  nextCursor?: string;
}

function fromApi(c: ApiChunk): LogLine {
  return {
    id: c.id,
    sequence: c.id, // output_chunks: id is the natural sequence
    channel: c.channel,
    content: c.content ?? "",
    promptExecutionId: c.prompt_execution_id,
    createdAt: c.created_at,
  };
}

export function reduceLogState(prev: LogLine[], incoming: LogLine[], cap: number): LogLine[] {
  if (incoming.length === 0) return prev;
  const seen = new Set(prev.map((l) => `${l.promptExecutionId}:${l.sequence}`));
  const fresh = incoming.filter((l) => !seen.has(`${l.promptExecutionId}:${l.sequence}`));
  if (fresh.length === 0) return prev;
  const merged = [...prev, ...fresh].sort((a, b) => a.sequence - b.sequence);
  if (merged.length <= cap) return merged;
  return merged.slice(merged.length - cap);
}

function bufferCap(): number {
  if (typeof window === "undefined") return 1500;
  return window.matchMedia("(max-width: 767px)").matches ? 1500 : 5000;
}

export function usePromptLogs(
  runId: string,
  promptExecutionId: string | null,
) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);

  useEffect(() => {
    setLines([]);
    setHasOlder(false);
    if (promptExecutionId === null) return;
    let cancelled = false;
    const cap = bufferCap();

    // Use the run-scoped logs endpoint with promptId filter (matches the actual route).
    const initialUrl = `/api/runs/${runId}/logs?promptId=${promptExecutionId}&limit=1000`;
    apiClient
      .get<ApiResponse>(initialUrl)
      .then((res) => {
        if (cancelled) return;
        setLines(reduceLogState([], res.chunks.map(fromApi), cap));
        setHasOlder(res.nextCursor !== undefined);
      })
      .catch(() => {
        /* logs are non-fatal — leave empty */
      });

    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel(channels.outputChunks(promptExecutionId))
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "output_chunks",
          filter: `prompt_execution_id=eq.${promptExecutionId}`,
        },
        (msg) => {
          const r = msg.new as ApiChunk;
          setLines((prev) => reduceLogState(prev, [fromApi(r)], cap));
        },
      )
      .subscribe((status) => setIsLive(status === "SUBSCRIBED"));

    return () => {
      cancelled = true;
      setIsLive(false);
      void supabase.removeChannel(channel);
    };
  }, [runId, promptExecutionId]);

  const loadOlder = async () => {
    if (lines.length === 0 || !hasOlder || promptExecutionId === null) return;
    // The current route uses cursor=base64(lastId) and is forward-only (id ASC).
    // For "older" semantics we'd need to add `?before=` server-side. For now,
    // we just fetch the next forward page and merge — dedup keeps it correct.
    // TODO(fase-11.5): add ?before= to /api/runs/:id/logs for true history scroll.
    const lastSeq = lines[lines.length - 1]?.sequence ?? 0;
    const cursor = Buffer.from(String(lastSeq), "utf8").toString("base64url");
    const res = await apiClient.get<ApiResponse>(
      `/api/runs/${runId}/logs?promptId=${promptExecutionId}&limit=500&cursor=${cursor}`,
    );
    setLines((prev) => reduceLogState(prev, res.chunks.map(fromApi), bufferCap()));
    setHasOlder(res.nextCursor !== undefined);
  };

  return { lines, isLive, hasOlder, loadOlder };
}

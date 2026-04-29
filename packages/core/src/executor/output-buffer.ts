import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createLogger } from "../logger.js";

export const FLUSH_INTERVAL_MS = 500;
export const FLUSH_CHUNK_THRESHOLD = 50;

const log = createLogger("executor:output-buffer");

export interface OutputChunkRecord {
  run_id: string;
  chunk: string;
  channel?: "stdout" | "stderr";
  created_at?: string;
}

export interface SupabaseLikeClient {
  from(table: string): {
    insert(rows: OutputChunkRecord[]): Promise<{ error: { message: string } | null }>;
  };
}

export interface OutputBufferOptions {
  flushIntervalMs?: number;
  chunkThreshold?: number;
  fallbackDir?: string;
  table?: string;
}

export interface OutputBuffer {
  push(chunk: string, channel?: "stdout" | "stderr"): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

interface BufferedChunk {
  chunk: string;
  channel: "stdout" | "stderr";
  createdAt: string;
}

export function createOutputBuffer(
  runId: string,
  supabaseClient: SupabaseLikeClient | null,
  options: OutputBufferOptions = {},
): OutputBuffer {
  const flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
  const chunkThreshold = options.chunkThreshold ?? FLUSH_CHUNK_THRESHOLD;
  const fallbackDir = options.fallbackDir ?? join(process.cwd(), ".conductor", "runs", runId);
  const fallbackFile = join(fallbackDir, "output.log");
  const table = options.table ?? "output_chunks";

  let pending: BufferedChunk[] = [];
  let flushing = false;
  let closed = false;
  let timer: NodeJS.Timeout | null = null;

  const scheduleFlush = (): void => {
    if (timer || closed) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, flushIntervalMs);
  };

  const writeFallback = async (rows: BufferedChunk[]): Promise<void> => {
    try {
      await mkdir(dirname(fallbackFile), { recursive: true });
      const lines = rows.map((r) => `[${r.createdAt}][${r.channel}] ${r.chunk}`).join("\n");
      await appendFile(fallbackFile, `${lines}\n`, "utf8");
    } catch (err) {
      log.error({ err, runId }, "output-buffer: fallback write failed");
    }
  };

  const flush = async (): Promise<void> => {
    if (flushing) return;
    if (pending.length === 0) return;
    flushing = true;
    const batch = pending;
    pending = [];
    try {
      if (supabaseClient) {
        const rows: OutputChunkRecord[] = batch.map((b) => ({
          run_id: runId,
          chunk: b.chunk,
          channel: b.channel,
          created_at: b.createdAt,
        }));
        const { error } = await supabaseClient.from(table).insert(rows);
        if (error) {
          log.warn({ err: error, runId }, "output-buffer: supabase insert failed, using fallback");
          await writeFallback(batch);
        }
      } else {
        await writeFallback(batch);
      }
    } catch (err) {
      log.warn({ err, runId }, "output-buffer: flush threw, using fallback");
      await writeFallback(batch);
    } finally {
      flushing = false;
    }
  };

  return {
    push(chunk: string, channel: "stdout" | "stderr" = "stdout"): void {
      if (closed) return;
      pending.push({ chunk, channel, createdAt: new Date().toISOString() });
      if (pending.length >= chunkThreshold) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        void flush();
      } else {
        scheduleFlush();
      }
    },
    async flush(): Promise<void> {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
    },
    async close(): Promise<void> {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
    },
  };
}

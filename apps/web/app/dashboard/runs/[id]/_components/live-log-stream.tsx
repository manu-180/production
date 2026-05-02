"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type LogChannel,
  type LogLine as LogLineType,
  usePromptLogs,
} from "@/hooks/use-prompt-logs";
import { cn } from "@/lib/utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import { DownloadIcon, PauseIcon, PlayIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LogLine } from "./log-line";

const CHANNELS: { id: LogChannel; label: string }[] = [
  { id: "stdout", label: "stdout" },
  { id: "stderr", label: "stderr" },
  { id: "tool", label: "tool" },
  { id: "claude", label: "claude" },
  { id: "meta", label: "meta" },
];

interface Props {
  runId: string;
  promptExecutionId: string | null;
  height?: number;
}

export function LiveLogStream({ runId, promptExecutionId, height = 360 }: Props) {
  const { lines, isLive } = usePromptLogs(runId, promptExecutionId);

  const [enabledChannels, setEnabledChannels] = useState<Set<string>>(
    () => new Set(["stdout", "stderr", "tool", "claude", "meta"]),
  );
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const parentRef = useRef<HTMLDivElement | null>(null);

  const visibleLines = useMemo<LogLineType[]>(() => {
    const q = search.trim().toLowerCase();
    return lines.filter((l) => {
      if (!enabledChannels.has(l.channel)) return false;
      if (q && !l.content.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [lines, enabledChannels, search]);

  const virtualizer = useVirtualizer({
    count: visibleLines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 18,
    overscan: 12,
  });

  // Auto-scroll to bottom on new lines if enabled.
  useEffect(() => {
    if (!autoScroll) return;
    if (visibleLines.length === 0) return;
    virtualizer.scrollToIndex(visibleLines.length - 1, { align: "end" });
  }, [autoScroll, visibleLines.length, virtualizer]);

  function toggleChannel(c: string) {
    setEnabledChannels((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  function downloadLog() {
    const blob = new Blob([visibleLines.map((l) => `[${l.channel}] ${l.content}`).join("\n")], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${promptExecutionId ?? "logs"}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col rounded-xl border border-border bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              isLive ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/50",
            )}
          />
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {isLive ? "En vivo" : "Inactivo"}
          </span>
        </div>

        <div className="flex flex-wrap gap-1">
          {CHANNELS.map((c) => {
            const active = enabledChannels.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleChannel(c.id)}
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide transition-colors",
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground/50 hover:text-muted-foreground",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="relative ml-auto min-w-[160px]">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar…"
            className="h-7 pl-6 text-xs"
          />
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setAutoScroll((s) => !s)}
          aria-label={
            autoScroll ? "Pausar desplazamiento automático" : "Reanudar desplazamiento automático"
          }
        >
          {autoScroll ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={downloadLog}
          aria-label="Descargar registros"
        >
          <DownloadIcon className="size-3.5" />
        </Button>
      </div>

      <div
        ref={parentRef}
        style={{ height }}
        className="overflow-auto bg-black/40 py-2 dark:bg-black/60"
      >
        {visibleLines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {promptExecutionId === null
              ? "Seleccioná un prompt para ver sus registros."
              : isLive
                ? "Esperando salida…"
                : "Sin registros aún."}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const line = visibleLines[vi.index];
              if (!line) return null;
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <LogLine line={line} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

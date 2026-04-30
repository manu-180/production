"use client";
import { memo } from "react";
import { cn } from "@/lib/utils";
import type { LogLine as LogLineType } from "@/hooks/use-prompt-logs";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function channelClass(ch: string): string {
  switch (ch) {
    case "stderr":
      return "text-rose-400 dark:text-rose-300";
    case "tool":
      return "text-violet-400 dark:text-violet-300";
    case "claude":
      return "text-sky-400 dark:text-sky-300";
    case "meta":
      return "text-muted-foreground";
    default:
      return "text-foreground";
  }
}

export const LogLine = memo(function LogLine({ line }: { line: LogLineType }) {
  const clean = line.content.replace(ANSI_RE, "");
  return (
    <div
      data-channel={line.channel}
      className={cn(
        "whitespace-pre font-mono text-[11.5px] leading-[1.45] px-3",
        channelClass(line.channel),
      )}
    >
      {clean}
    </div>
  );
});

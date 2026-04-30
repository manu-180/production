"use client";
import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/ui/format";

interface Props {
  startedAt: string | null;
  finishedAt: string | null;
  isRunning: boolean;
}

export function RunDuration({ startedAt, finishedAt, isRunning }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  if (startedAt === null) return <span>—</span>;
  const end = finishedAt !== null ? new Date(finishedAt).getTime() : now;
  const ms = Math.max(0, end - new Date(startedAt).getTime());
  return <span className="font-mono tabular-nums">{formatDuration(ms)}</span>;
}

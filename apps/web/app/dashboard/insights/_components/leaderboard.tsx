"use client";

interface LeaderboardEntry {
  plan_id: string | null;
  total_runs: number;
}

interface LeaderboardProps {
  runs: LeaderboardEntry[];
}

function truncate(id: string, maxLen = 20): string {
  if (id.length <= maxLen) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

export function Leaderboard({ runs }: LeaderboardProps) {
  // Aggregate by plan_id
  const counts = new Map<string, number>();
  for (const r of runs) {
    const key = r.plan_id ?? "(sin plan)";
    counts.set(key, (counts.get(key) ?? 0) + r.total_runs);
  }

  const sorted = Array.from(counts.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  if (sorted.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">Sin datos todavía</div>;
  }

  const maxRuns = sorted[0]?.[1] ?? 1;

  return (
    <ol className="flex flex-col gap-3">
      {sorted.map(([planId, count], idx) => (
        <li key={planId} className="flex items-center gap-3">
          <span className="w-5 shrink-0 text-right text-xs font-semibold text-muted-foreground">
            {idx + 1}
          </span>
          <span className="w-44 shrink-0 truncate font-mono text-xs" title={planId}>
            {truncate(planId)}
          </span>
          <div className="flex flex-1 items-center gap-2">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${Math.round((count / maxRuns) * 100)}%` }}
            />
            <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

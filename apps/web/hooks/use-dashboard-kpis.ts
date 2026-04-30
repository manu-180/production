"use client";
import type { Run } from "@conductor/db";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";

interface ListResponse {
  runs: Run[];
  nextCursor?: string;
}

export interface DashboardKpis {
  runsToday: number;
  runsThisWeek: number;
  runsTotal: number;
  costThisMonth: number;
  successRate30d: number;
  avgDurationMs: number | null;
  activeCount: number;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function aggregate(runs: Run[]): DashboardKpis {
  const now = new Date();
  const today = startOfDay(now).getTime();
  const weekAgo = today - 6 * 24 * 60 * 60 * 1000;
  const monthStart = startOfMonth(now).getTime();
  const thirtyDaysAgo = today - 30 * 24 * 60 * 60 * 1000;

  let runsToday = 0;
  let runsThisWeek = 0;
  let costThisMonth = 0;
  let active = 0;

  let last30dCount = 0;
  let last30dSucceeded = 0;
  let durationCount = 0;
  let durationTotal = 0;

  for (const r of runs) {
    const created = new Date(r.created_at).getTime();
    if (created >= today) runsToday++;
    if (created >= weekAgo) runsThisWeek++;
    if (created >= monthStart) costThisMonth += r.total_cost_usd;
    if (r.status === "running" || r.status === "paused") active++;

    if (created >= thirtyDaysAgo && r.status !== "queued" && r.status !== "running") {
      last30dCount++;
      if (r.status === "completed") last30dSucceeded++;
    }

    if (r.started_at !== null && r.finished_at !== null) {
      const dur = new Date(r.finished_at).getTime() - new Date(r.started_at).getTime();
      if (Number.isFinite(dur) && dur > 0) {
        durationTotal += dur;
        durationCount++;
      }
    }
  }

  return {
    runsToday,
    runsThisWeek,
    runsTotal: runs.length,
    costThisMonth,
    successRate30d: last30dCount > 0 ? last30dSucceeded / last30dCount : 0,
    avgDurationMs: durationCount > 0 ? durationTotal / durationCount : null,
    activeCount: active,
  };
}

/**
 * Client-side aggregation over the most recent 200 runs is fine until we cross
 * ~5k runs total. After that, see docs/plans/2026-04-30-fase-11-ui-dashboard.md
 * §0.6 item 3 — server endpoint /api/dashboard/kpis.
 */
export function useDashboardKpis() {
  return useQuery<DashboardKpis>({
    queryKey: qk.kpis(),
    queryFn: async ({ signal }) => {
      const data = await apiClient.get<ListResponse>("/api/runs?limit=200", { signal });
      return aggregate(data.runs);
    },
    staleTime: 30_000,
  });
}

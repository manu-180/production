"use client";
import {
  ActivityIcon,
  BarChart3Icon,
  ClockIcon,
  DollarSignIcon,
  RocketIcon,
} from "lucide-react";
import { useActiveRuns, useRunsList } from "@/hooks/use-runs-list";
import { useDashboardKpis } from "@/hooks/use-dashboard-kpis";
import { formatCostUsd, formatDuration } from "@/lib/ui/format";
import { ActiveRunCard } from "./_components/active-run-card";
import { KpiCard } from "./_components/kpi-card";
import { RecentRunsList } from "./_components/recent-runs-list";

export default function DashboardHomePage() {
  const kpis = useDashboardKpis();
  const recent = useRunsList({ limit: 20 });
  const active = useActiveRuns();

  const recentRuns = recent.data?.pages.flatMap((p) => p.runs) ?? [];
  const activeRuns = active.data?.pages.flatMap((p) => p.runs) ?? [];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Live view of your runs, costs, and Claude activity.
        </p>
      </header>

      <section
        aria-label="Key metrics"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <KpiCard
          label="Runs today"
          value={kpis.data?.runsToday ?? "—"}
          delta={`${kpis.data?.runsThisWeek ?? 0} this week`}
          icon={ActivityIcon}
          tone="info"
          loading={kpis.isLoading}
        />
        <KpiCard
          label="Active"
          value={kpis.data?.activeCount ?? "—"}
          delta={kpis.data?.activeCount ? "running now" : "all idle"}
          icon={RocketIcon}
          tone={kpis.data?.activeCount ? "success" : "neutral"}
          loading={kpis.isLoading}
        />
        <KpiCard
          label="Cost this month"
          value={kpis.data ? formatCostUsd(kpis.data.costThisMonth) : "—"}
          icon={DollarSignIcon}
          tone="warning"
          loading={kpis.isLoading}
        />
        <KpiCard
          label="Success rate (30d)"
          value={
            kpis.data
              ? `${Math.round(kpis.data.successRate30d * 100)}%`
              : "—"
          }
          icon={BarChart3Icon}
          tone="success"
          loading={kpis.isLoading}
        />
        <KpiCard
          label="Avg run duration"
          value={
            kpis.data?.avgDurationMs !== null && kpis.data?.avgDurationMs !== undefined
              ? formatDuration(kpis.data.avgDurationMs)
              : "—"
          }
          icon={ClockIcon}
          tone="neutral"
          loading={kpis.isLoading}
        />
      </section>

      {activeRuns.length > 0 && (
        <section aria-label="Active runs" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg font-semibold tracking-tight">
              Active runs
            </h2>
            <span className="text-xs text-muted-foreground">
              {activeRuns.length} running or paused
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {activeRuns.map((r) => (
              <ActiveRunCard key={r.id} run={r} />
            ))}
          </div>
        </section>
      )}

      <section aria-label="Recent runs" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold tracking-tight">
            Recent runs
          </h2>
        </div>
        <RecentRunsList runs={recentRuns} isLoading={recent.isLoading} />
      </section>
    </div>
  );
}

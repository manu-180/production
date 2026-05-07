import { headers } from "next/headers";
import { KpiCard } from "../_components/kpi-card";
import { DailyCostChart } from "./_components/daily-cost-chart";
import { StatusBarChart } from "./_components/status-bar-chart";

type TrendsKpis = {
  successRate30d: number;
  totalCost30d: number;
  avgDurationMs: number | null;
  totalRuns30d: number;
};

type DailyCostEntry = {
  date: string;
  costUsd: number;
  runs: number;
};

type StatusCounts = {
  completed: number;
  failed: number;
  cancelled: number;
  running: number;
};

type TrendsData = {
  kpis: TrendsKpis;
  dailyCost: DailyCostEntry[];
  statusCounts: StatusCounts;
};

async function fetchTrends(): Promise<TrendsData | null> {
  try {
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    const cookie = h.get("cookie") ?? "";

    const res = await fetch(`${proto}://${host}/api/trends`, {
      cache: "no-store",
      headers: { cookie },
    });
    if (!res.ok) return null;
    return (await res.json()) as TrendsData;
  } catch {
    return null;
  }
}

export default async function TrendsPage() {
  const data = await fetchTrends();

  return (
    <div className="mx-auto max-w-7xl flex flex-col gap-8 pb-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tendencias</h1>
        <p className="mt-1 text-sm text-muted-foreground">Métricas de los últimos 30 días.</p>
      </div>

      {data === null ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          No se pudieron cargar las tendencias.
        </div>
      ) : (
        <>
          <section
            aria-label="KPIs de tendencias"
            className="grid grid-cols-1 md:grid-cols-3 gap-4"
          >
            <KpiCard
              label="Tasa de éxito (30d)"
              value={`${(data.kpis.successRate30d * 100).toFixed(1)}%`}
              tone="success"
            />
            <KpiCard
              label="Costo total (30d)"
              value={`$${data.kpis.totalCost30d.toFixed(2)}`}
              tone="warning"
            />
            <KpiCard label="Runs totales (30d)" value={data.kpis.totalRuns30d} tone="info" />
          </section>

          <section aria-label="Costo diario">
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <div className="mb-4">
                <h2 className="text-base font-semibold tracking-tight">
                  Costo diario (últimos 30 días)
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Costo en USD acumulado por día junto al número de runs ejecutados.
                </p>
              </div>
              <DailyCostChart data={data.dailyCost} />
            </div>
          </section>

          <section aria-label="Distribución por estado">
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <div className="mb-4">
                <h2 className="text-base font-semibold tracking-tight">Distribución por estado</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Cantidad de runs por estado en los últimos 30 días.
                </p>
              </div>
              <StatusBarChart data={data.statusCounts} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

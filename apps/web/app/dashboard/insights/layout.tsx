import { InsightsTabs } from "./_components/insights-tabs";

export default function InsightsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Perspectivas</h1>
        <p className="text-sm text-muted-foreground">
          Métricas, costos y registro de auditoría de toda la actividad.
        </p>
      </div>
      <InsightsTabs />
      {children}
    </div>
  );
}

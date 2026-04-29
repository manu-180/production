import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface GuardianMetrics {
  totalInterventions: number;
  byStrategy: Record<"rule" | "default" | "llm", number>;
  averageConfidence: number;
  overrideRate: number;
}

interface Props {
  metrics: GuardianMetrics;
  className?: string;
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
}) {
  return (
    <Card size="sm" className="flex-1 min-w-0">
      <CardHeader>
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums leading-none">{value}</p>
        {sub !== undefined && <div className="mt-1.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function GuardianMetricsWidget({ metrics, className }: Props) {
  const avgConfidencePct = Math.round(metrics.averageConfidence * 100);
  const overridePct = Math.round(metrics.overrideRate * 100);
  const { rule, default: def, llm } = metrics.byStrategy;

  return (
    <div className={cn("flex flex-wrap gap-3", className)}>
      <MetricCard label="Total Interventions" value={String(metrics.totalInterventions)} />
      <MetricCard label="Avg Confidence" value={`${avgConfidencePct}%`} />
      <MetricCard label="Override Rate" value={`${overridePct}%`} />
      <MetricCard
        label="By Strategy"
        value={`${rule + def + llm}`}
        sub={
          <span className="flex gap-2">
            <span>rule: {rule}</span>
            <span>default: {def}</span>
            <span>llm: {llm}</span>
          </span>
        }
      />
    </div>
  );
}

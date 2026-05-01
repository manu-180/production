"use client";
import type { GuardianDailyMetric } from "@conductor/core";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface ConfidenceTrendChartProps {
  data: GuardianDailyMetric[];
}

function formatDay(day: string): string {
  return new Date(day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ConfidenceTrendChart({ data }: ConfidenceTrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        No data yet
      </div>
    );
  }

  // Aggregate by day: weighted average of avgConfidence across all strategies
  const byDay = new Map<string, { totalWeight: number; weightedSum: number }>();
  for (const row of data) {
    const existing = byDay.get(row.day) ?? { totalWeight: 0, weightedSum: 0 };
    existing.totalWeight += row.totalDecisions;
    existing.weightedSum += row.avgConfidence * row.totalDecisions;
    byDay.set(row.day, existing);
  }

  const chartData = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, { totalWeight, weightedSum }]) => ({
      label: formatDay(day),
      confidence: totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : 0,
    }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis
          domain={[0, 1]}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={36}
          tickFormatter={(v: number) => v.toFixed(1)}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: "6px",
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--popover))",
            color: "hsl(var(--popover-foreground))",
          }}
          formatter={(value: number) => [value.toFixed(3), "Avg confidence"]}
        />
        <Line
          type="monotone"
          dataKey="confidence"
          name="Avg confidence"
          stroke="#10b981"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

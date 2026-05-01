"use client";
import type { GuardianDailyMetric } from "@conductor/core";
import { useMemo } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface ConfidenceTrendChartProps {
  data: GuardianDailyMetric[];
}

function formatDay(day: string): string {
  // Parse YYYY-MM-DD as local midnight to avoid UTC→local shift on date labels
  const parts = day.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function ConfidenceTrendChart({ data }: ConfidenceTrendChartProps) {
  const chartData = useMemo(() => {
    const byDay = new Map<string, { totalWeight: number; weightedSum: number }>();
    for (const row of data) {
      const existing = byDay.get(row.day) ?? { totalWeight: 0, weightedSum: 0 };
      existing.totalWeight += row.totalDecisions;
      existing.weightedSum += row.avgConfidence * row.totalDecisions;
      byDay.set(row.day, existing);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, { totalWeight, weightedSum }]) => ({
        label: formatDay(day),
        confidence: totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : 0,
      }));
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        No data yet
      </div>
    );
  }

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
          formatter={(value) =>
            typeof value === "number"
              ? [value.toFixed(3), "Avg confidence"]
              : [String(value), "Avg confidence"]
          }
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

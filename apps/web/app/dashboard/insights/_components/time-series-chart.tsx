"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface TimeSeriesDataPoint {
  day: string;
  successful: number;
  failed: number;
  cancelled: number;
}

interface TimeSeriesChartProps {
  data: TimeSeriesDataPoint[];
}

function formatDay(day: string): string {
  return new Date(day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function TimeSeriesChart({ data }: TimeSeriesChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Sin datos todavía
      </div>
    );
  }

  const chartData = [...data].reverse().map((d) => ({
    ...d,
    label: formatDay(d.day),
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={32}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: "6px",
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--popover))",
            color: "hsl(var(--popover-foreground))",
          }}
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar
          dataKey="successful"
          name="Exitosas"
          stackId="a"
          fill="#10b981"
          radius={[0, 0, 0, 0]}
        />
        <Bar dataKey="failed" name="Fallidas" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} />
        <Bar
          dataKey="cancelled"
          name="Canceladas"
          stackId="a"
          fill="#f59e0b"
          radius={[2, 2, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

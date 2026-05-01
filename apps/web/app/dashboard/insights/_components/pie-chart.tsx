"use client";
import {
  Cell,
  Legend,
  Pie,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export interface PieChartDataPoint {
  name: string;
  value: number;
  color: string;
}

interface PieChartProps {
  data: PieChartDataPoint[];
}

export function PieChart({ data }: PieChartProps) {
  const filled = data.filter((d) => d.value > 0);

  if (filled.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        No data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <RechartsPieChart>
        <Pie
          data={filled}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="45%"
          innerRadius={52}
          outerRadius={80}
          paddingAngle={2}
        >
          {filled.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: "6px",
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--popover))",
            color: "hsl(var(--popover-foreground))",
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </RechartsPieChart>
    </ResponsiveContainer>
  );
}

"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type StatusCounts = {
  completed: number;
  failed: number;
  cancelled: number;
  running: number;
};

type Props = {
  data: StatusCounts;
};

type BarEntry = {
  status: string;
  value: number;
  fill: string;
};

type CustomTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: BarEntry }>;
};

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const first = payload[0];
  if (!first) return null;
  const entry = first.payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium">{entry.status}</p>
      <p className="text-muted-foreground">
        Cantidad: <span className="font-medium text-foreground">{entry.value}</span>
      </p>
    </div>
  );
}

function yTickFormatter(value: number): string {
  return Number.isInteger(value) ? String(value) : "";
}

export function StatusBarChart({ data }: Props) {
  const chartData: BarEntry[] = [
    { status: "Completados", value: data.completed, fill: "hsl(142 70% 45%)" },
    { status: "Fallidos", value: data.failed, fill: "hsl(0 75% 55%)" },
    { status: "Cancelados", value: data.cancelled, fill: "hsl(38 90% 55%)" },
    { status: "En curso", value: data.running, fill: "hsl(var(--primary))" },
  ];

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
        <XAxis
          dataKey="status"
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tickFormatter={yTickFormatter}
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--muted)/0.1" }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {chartData.map((entry) => (
            <Cell key={entry.status} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

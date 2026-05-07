"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type DailyCostEntry = {
  date: string;
  costUsd: number;
  runs: number;
};

type Props = {
  data: DailyCostEntry[];
};

function formatDate(dateStr: string): string {
  const parts = dateStr.split("-").map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

type TooltipPayload = {
  value: number;
  payload: DailyCostEntry;
};

type CustomTooltipProps = {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
};

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const first = payload[0];
  if (!first) return null;
  const entry = first.payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      <p className="text-muted-foreground">
        Costo: <span className="font-medium text-foreground">{formatUsd(entry.costUsd)}</span>
      </p>
      <p className="text-muted-foreground">
        Runs: <span className="font-medium text-foreground">{entry.runs}</span>
      </p>
    </div>
  );
}

export function DailyCostChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={formatUsd}
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          width={60}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: "var(--border)" }} />
        <Line
          type="monotone"
          dataKey="costUsd"
          stroke="var(--primary)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--primary)", strokeWidth: 0 }}
          activeDot={{ r: 5, fill: "var(--primary)", strokeWidth: 0 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

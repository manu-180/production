"use client";
import { Card, CardContent } from "@/components/ui/card";
import { formatTokens } from "@/lib/ui/format";

interface Props {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
}

function Bar({
  label,
  value,
  max,
  tone,
}: { label: string; value: number; max: number; tone: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono">{formatTokens(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function TokenMeter({ inputTokens, outputTokens, cacheTokens }: Props) {
  const total = inputTokens + outputTokens + cacheTokens;
  const max = Math.max(inputTokens, outputTokens, cacheTokens, 1);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Tokens
          </h3>
          <span className="font-mono text-lg font-semibold tracking-tight">
            {formatTokens(total)}
          </span>
        </div>
        <div className="space-y-2.5">
          <Bar label="Entrada" value={inputTokens} max={max} tone="bg-sky-500" />
          <Bar label="Salida" value={outputTokens} max={max} tone="bg-emerald-500" />
          <Bar label="Caché" value={cacheTokens} max={max} tone="bg-violet-500" />
        </div>
      </CardContent>
    </Card>
  );
}

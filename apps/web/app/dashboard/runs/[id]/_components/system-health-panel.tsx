"use client";
import { Card, CardContent } from "@/components/ui/card";
import { useSystemHealth } from "@/hooks/use-system-health";
import { cn } from "@/lib/utils";

function Row({
  label,
  ok,
  sublabel,
}: { label: string; ok: "ok" | "warn" | "bad" | "muted"; sublabel?: string }) {
  const tone =
    ok === "ok"
      ? "bg-emerald-500"
      : ok === "warn"
        ? "bg-amber-500"
        : ok === "bad"
          ? "bg-rose-500"
          : "bg-muted-foreground/40";
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className={cn("inline-block size-1.5 rounded-full", tone)} aria-hidden="true" />
        <span className="text-[11px] text-foreground">{label}</span>
      </div>
      {sublabel && <span className="font-mono text-[10px] text-muted-foreground">{sublabel}</span>}
    </div>
  );
}

export function SystemHealthPanel({ isLive }: { isLive: boolean }) {
  const { data, isLoading } = useSystemHealth();

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Sistema
        </h3>
        <Row
          label="Tiempo real"
          ok={isLive ? "ok" : "warn"}
          sublabel={isLive ? "suscripto" : "conectando…"}
        />
        <Row
          label="Worker"
          ok={
            isLoading
              ? "muted"
              : data?.worker === "ok"
                ? "ok"
                : data?.worker === "offline"
                  ? "warn"
                  : "bad"
          }
          sublabel={data?.worker ?? "—"}
        />
        <Row
          label="Base de datos"
          ok={isLoading ? "muted" : data?.db === "ok" ? "ok" : "bad"}
          sublabel={data?.db ?? "—"}
        />
        <Row
          label="Claude CLI"
          ok={isLoading ? "muted" : data?.claudeCli.installed ? "ok" : "bad"}
          sublabel={
            data?.claudeCli.version ?? (data?.claudeCli.installed ? "instalado" : "no encontrado")
          }
        />
      </CardContent>
    </Card>
  );
}

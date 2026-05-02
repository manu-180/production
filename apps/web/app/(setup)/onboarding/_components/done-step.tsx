"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, CheckCircle, FolderOpen, Loader, Terminal, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type Props = {
  workingDir: string;
};

type HealthStatus = "loading" | "ok" | "warn" | "error";

type HealthItem = {
  label: string;
  status: HealthStatus;
  detail?: string;
};

function HealthRow({ item }: { item: HealthItem }) {
  return (
    <div className="flex items-center gap-2.5 text-sm">
      {item.status === "loading" && (
        <Loader className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      )}
      {item.status === "ok" && <CheckCircle className="size-3.5 shrink-0 text-emerald-500" />}
      {item.status === "warn" && <AlertCircle className="size-3.5 shrink-0 text-amber-500" />}
      {item.status === "error" && <XCircle className="size-3.5 shrink-0 text-destructive" />}
      <span className={item.status === "loading" ? "text-muted-foreground" : "text-foreground"}>
        {item.label}
      </span>
      {item.detail && (
        <span className="ml-auto font-mono text-xs text-muted-foreground">{item.detail}</span>
      )}
    </div>
  );
}

export function DoneStep({ workingDir }: Props) {
  const [health, setHealth] = useState<HealthItem[]>([
    { label: "Token de Claude", status: "loading" },
    { label: "Claude CLI", status: "loading" },
  ]);

  useEffect(() => {
    async function runChecks() {
      const [tokenRes, cliRes] = await Promise.allSettled([
        fetch("/api/auth/claude-token").then((r) => r.json()),
        fetch("/api/system/claude-cli").then((r) => r.json()),
      ]);

      const tokenData =
        tokenRes.status === "fulfilled" &&
        typeof tokenRes.value === "object" &&
        tokenRes.value !== null
          ? (tokenRes.value as Record<string, unknown>)
          : null;

      const cliData =
        cliRes.status === "fulfilled" && typeof cliRes.value === "object" && cliRes.value !== null
          ? (cliRes.value as Record<string, unknown>)
          : null;

      const tokenConfigured = tokenData?.["configured"] === true;
      const cliInstalled = cliData?.["installed"] === true;
      const cliVersion =
        typeof cliData?.["version"] === "string" ? (cliData["version"] as string) : undefined;

      setHealth([
        {
          label: "Token de Claude",
          status: tokenConfigured ? "ok" : "warn",
          detail: tokenConfigured ? "configurado" : "no configurado",
        },
        {
          label: "Claude CLI",
          status: cliInstalled ? "ok" : "warn",
          detail: cliVersion ?? (cliInstalled ? "instalado" : "no encontrado"),
        },
      ]);
    }

    runChecks().catch(() => {
      setHealth([
        { label: "Token de Claude", status: "error" },
        { label: "Claude CLI", status: "error" },
      ]);
    });
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Todo listo</CardTitle>
        <CardDescription>
          Conductor está configurado y listo para orquestar tus procesos de Claude CLI.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {/* Health check */}
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-3 flex flex-col gap-2">
          <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground mb-1">
            Estado del sistema
          </p>
          {health.map((item) => (
            <HealthRow key={item.label} item={item} />
          ))}

          {workingDir && (
            <div className="flex items-center gap-2.5 text-sm">
              <FolderOpen className="size-3.5 shrink-0 text-emerald-500" />
              <span className="text-foreground">Directorio de trabajo</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground truncate max-w-[180px]">
                {workingDir}
              </span>
            </div>
          )}
        </div>

        {/* Quick start hint */}
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 flex items-start gap-2.5">
          <Terminal className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground leading-snug">
            Andá al dashboard para crear tu primer plan. Definí los prompts, establecé checkpoints y
            dejá que Conductor se encargue del resto.
          </p>
        </div>

        <Button
          size="lg"
          className="w-full"
          render={
            <Link href="/" className="inline-flex items-center justify-center gap-2">
              Ir al Dashboard
            </Link>
          }
        />
      </CardContent>
    </Card>
  );
}

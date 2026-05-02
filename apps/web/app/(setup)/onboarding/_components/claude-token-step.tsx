"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CheckCircle, ChevronRight, XCircle } from "lucide-react";
import { useState } from "react";

type Props = {
  onComplete: () => void;
};

type SubmitState = "idle" | "loading" | "success" | "error";

const STEPS: { id: string; content: React.ReactNode }[] = [
  { id: "open-terminal", content: "Abrí una terminal en esta máquina" },
  {
    id: "run-command",
    content: (
      <>
        Ejecutá:{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8em]">
          claude setup-token
        </code>
      </>
    ),
  },
  { id: "oauth-flow", content: "Seguí el flujo OAuth que se abre en tu navegador" },
  { id: "copy-token", content: "Copiá el token largo que aparece en la terminal" },
  { id: "paste-token", content: "Pegalo en el campo de abajo" },
];

export function ClaudeTokenStep({ onComplete }: Props) {
  const [token, setToken] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmed = token.trim();
    if (!trimmed) return;

    setState("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/auth/claude-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: trimmed }),
      });

      const data: unknown = await res.json();
      const ok =
        typeof data === "object" && data !== null && "ok" in data
          ? (data as { ok: unknown }).ok === true
          : false;

      if (ok) {
        setState("success");
      } else {
        const msg =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : "La validación del token falló. Asegurate de haber copiado el token completo.";
        setState("error");
        setErrorMsg(msg);
      }
    } catch {
      setState("error");
      setErrorMsg("Error de red — ¿está corriendo el servidor?");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conectá tu cuenta de Claude</CardTitle>
        <CardDescription>
          Conductor necesita conectarse a tu cuenta de Claude para ejecutar prompts. Usa tu plan
          existente — no se consumen créditos adicionales.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {/* Instructions */}
        <ol className="flex flex-col gap-2">
          {STEPS.map((step, i) => (
            <li key={step.id} className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-medium text-foreground">
                {i + 1}
              </span>
              <span className="leading-snug">{step.content}</span>
            </li>
          ))}
        </ol>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            type="password"
            placeholder="Pegá tu token acá"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              if (state === "error") setState("idle");
            }}
            aria-invalid={state === "error"}
            disabled={state === "loading" || state === "success"}
            className="font-mono text-sm"
          />

          {state === "error" && (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <XCircle className="size-3.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {state !== "success" ? (
            <Button
              type="submit"
              disabled={!token.trim() || state === "loading"}
              className="w-full"
            >
              {state === "loading" ? "Validando…" : "Validar y guardar"}
            </Button>
          ) : (
            <div className="flex flex-col gap-3">
              <div
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400",
                )}
              >
                <CheckCircle className="size-4 shrink-0" />
                <span>Token validado y guardado.</span>
              </div>
              <Button type="button" onClick={onComplete} className="w-full">
                Continuar
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

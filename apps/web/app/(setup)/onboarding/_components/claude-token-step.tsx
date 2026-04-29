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
  { id: "open-terminal", content: "Open a terminal on this machine" },
  {
    id: "run-command",
    content: (
      <>
        Run:{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8em]">
          claude setup-token
        </code>
      </>
    ),
  },
  { id: "oauth-flow", content: "Follow the OAuth flow that opens in your browser" },
  { id: "copy-token", content: "Copy the long token that appears in the terminal" },
  { id: "paste-token", content: "Paste it in the field below" },
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
            : "Token validation failed. Make sure you copied the full token.";
        setState("error");
        setErrorMsg(msg);
      }
    } catch {
      setState("error");
      setErrorMsg("Network error — is the server running?");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect your Claude account</CardTitle>
        <CardDescription>
          Conductor needs to connect to your Claude account to run prompts. This uses your existing
          plan — no extra credits are consumed.
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
            placeholder="Paste your token here"
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
              {state === "loading" ? "Validating…" : "Validate & Save"}
            </Button>
          ) : (
            <div className="flex flex-col gap-3">
              <div
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400",
                )}
              >
                <CheckCircle className="size-4 shrink-0" />
                <span>Token validated and saved.</span>
              </div>
              <Button type="button" onClick={onComplete} className="w-full">
                Continue
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

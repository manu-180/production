"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AlertCircle, CheckCircle, ChevronRight, FolderOpen, GitBranch } from "lucide-react";
import { useState } from "react";

type Props = {
  onComplete: (dir: string) => void;
};

type PathInfo = {
  exists: boolean;
  isDir: boolean;
  isWritable: boolean;
  isGitRepo: boolean;
};

type ValidationState = "idle" | "loading" | "valid" | "invalid";

function PathStatusRow({
  ok,
  label,
}: {
  ok: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle className="size-3.5 shrink-0 text-emerald-500" />
      ) : (
        <AlertCircle className="size-3.5 shrink-0 text-amber-500" />
      )}
      <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}

export function WorkingDirStep({ onComplete }: Props) {
  const [path, setPath] = useState("");
  const [validationState, setValidationState] = useState<ValidationState>("idle");
  const [pathInfo, setPathInfo] = useState<PathInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  async function handleValidate() {
    const trimmed = path.trim();
    if (!trimmed) return;

    setValidationState("loading");
    setPathInfo(null);
    setErrorMsg("");

    try {
      const res = await fetch("/api/system/check-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: trimmed }),
      });

      const data: unknown = await res.json();

      if (
        typeof data === "object" &&
        data !== null &&
        "exists" in data &&
        "isDir" in data &&
        "isWritable" in data &&
        "isGitRepo" in data
      ) {
        const info = data as PathInfo;
        setPathInfo(info);
        setValidationState(info.exists && info.isDir ? "valid" : "invalid");

        if (!info.exists) {
          setErrorMsg("Path does not exist on this machine.");
        } else if (!info.isDir) {
          setErrorMsg("Path exists but is a file, not a directory.");
        }
      } else {
        setValidationState("invalid");
        setErrorMsg("Unexpected response from server.");
      }
    } catch {
      setValidationState("invalid");
      setErrorMsg("Network error — is the server running?");
    }
  }

  function handleContinue() {
    const trimmed = path.trim();
    localStorage.setItem("conductor:workingDir", trimmed);
    onComplete(trimmed);
  }

  const canValidate = path.trim().length > 0 && validationState !== "loading";
  const canContinue = validationState === "valid" && pathInfo?.isDir === true;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set a default working directory</CardTitle>
        <CardDescription>
          Conductor will use this directory as the root for Claude CLI processes unless you override
          it per-task.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Input
            type="text"
            placeholder={
              process.platform === "win32"
                ? "e.g. C:\\Projects\\my-app"
                : "e.g. /home/user/projects/my-app"
            }
            value={path}
            onChange={(e) => {
              setPath(e.target.value);
              if (validationState !== "idle") {
                setValidationState("idle");
                setPathInfo(null);
                setErrorMsg("");
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleValidate();
            }}
            aria-invalid={validationState === "invalid"}
            disabled={validationState === "loading"}
            className="font-mono text-sm"
          />
          <Button type="button" variant="outline" onClick={handleValidate} disabled={!canValidate}>
            {validationState === "loading" ? "Checking…" : "Validate"}
          </Button>
        </div>

        {/* Validation result */}
        {validationState === "invalid" && errorMsg && (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="size-3.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {pathInfo !== null && validationState === "valid" && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 flex flex-col gap-1.5">
            <PathStatusRow ok={pathInfo.exists} label="Directory exists" />
            <PathStatusRow ok={pathInfo.isWritable} label="Writable" />
            <div className="flex items-center gap-2 text-sm">
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
              <span className={pathInfo.isGitRepo ? "text-foreground" : "text-muted-foreground"}>
                {pathInfo.isGitRepo ? "Git repository detected" : "Not a git repository"}
              </span>
            </div>
          </div>
        )}

        {/* Skip option */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onComplete("")}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline hover:text-foreground transition-colors"
          >
            Skip for now
          </button>
          <Button type="button" onClick={handleContinue} disabled={!canContinue}>
            <FolderOpen className="size-4" />
            Save & Continue
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

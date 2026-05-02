import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, XCircle } from "lucide-react";

type TokenResponse = {
  configured?: boolean;
};

async function getClaudeAuthStatus(): Promise<{ label: string; ok: boolean | null }> {
  try {
    const baseUrl = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/auth/claude-token`, {
      next: { revalidate: 30 },
    });

    if (!res.ok) {
      return { label: "Claude con error", ok: false };
    }

    const data: TokenResponse = (await res.json()) as TokenResponse;

    if (data.configured === true) {
      return { label: "Claude conectado", ok: true };
    }

    return { label: "Claude no configurado", ok: null };
  } catch {
    return { label: "Claude con error", ok: false };
  }
}

export async function ClaudeAuthStatus() {
  const status = await getClaudeAuthStatus();

  return (
    <Badge variant="outline" className="flex items-center gap-1.5 px-3 py-1 text-xs font-mono">
      {status.ok === true && <CheckCircle className="size-3 text-emerald-500" />}
      {status.ok === false && <XCircle className="size-3 text-red-500" />}
      {status.ok === null && <AlertCircle className="size-3 text-amber-500" />}
      {status.label}
    </Badge>
  );
}

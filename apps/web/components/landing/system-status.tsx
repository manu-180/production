import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, XCircle } from "lucide-react";

type StatusResult = {
  label: string;
  ok: boolean | null; // null = not configured
};

async function checkSupabase(): Promise<StatusResult> {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];

  if (!url || !key) {
    return { label: "BD no configurada", ok: null };
  }

  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      next: { revalidate: 30 },
    });
    // Any HTTP response means the server is reachable (401 = up but needs auth,
    // which is expected for an unauthenticated health-check against a secured project).
    const reachable = res.status < 500;
    return {
      label: reachable ? "Supabase conectado" : "Supabase inaccesible",
      ok: reachable,
    };
  } catch {
    return { label: "Supabase inaccesible", ok: false };
  }
}

export async function SystemStatus() {
  const supabase = await checkSupabase();

  const items = [supabase];

  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {items.map((item) => (
        <Badge
          key={item.label}
          variant="outline"
          className="flex items-center gap-1.5 px-3 py-1 text-xs font-mono"
        >
          {item.ok === true && <CheckCircle className="size-3 text-emerald-500" />}
          {item.ok === false && <XCircle className="size-3 text-red-500" />}
          {item.ok === null && <AlertCircle className="size-3 text-amber-500" />}
          {item.label}
        </Badge>
      ))}
    </div>
  );
}

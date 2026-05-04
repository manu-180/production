# Workers Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Workers Panel to the Conductor dashboard that shows active/zombie worker processes in real time, with a per-worker kill button.

**Architecture:** A new `worker_commands` table (Supabase) acts as a command bus: the Next.js API writes kill commands there, and the worker polls the table every 3 s (same cadence as run polling) and calls `gracefulShutdown()` when a command for its own ID is found. The dashboard reads `worker_instances` via a new `/api/workers` route and refreshes every 30 s.

**Tech Stack:** Next.js 15 (App Router) · TypeScript strict · Tailwind + shadcn/ui · TanStack Query v5 · Supabase (service-role client) · Node.js worker (ESM)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20260503000002_worker_commands.sql` | `worker_commands` table + deny-all RLS |
| Create | `apps/web/lib/types/workers.ts` | Shared `WorkerRow` / `WorkerStatus` types |
| Create | `apps/web/app/api/workers/route.ts` | `GET /api/workers` — list instances with derived status |
| Create | `apps/web/app/api/workers/[id]/kill/route.ts` | `POST /api/workers/:id/kill` — enqueue kill command |
| Modify | `apps/web/lib/react-query/keys.ts` | Add `workers` key namespace |
| Create | `apps/web/hooks/use-workers.ts` | React Query hook (30 s refetch) |
| Create | `apps/web/app/dashboard/_components/workers-panel.tsx` | Workers table with status badge + kill button |
| Modify | `apps/web/app/dashboard/page.tsx` | Render `<WorkersPanel />` section |
| Modify | `apps/worker/src/index.ts` | Poll `worker_commands`; call graceful shutdown + cleanup |

---

## Task 1 — DB migration: worker_commands table

**Files:**
- Create: `supabase/migrations/20260503000002_worker_commands.sql`

- [ ] **Step 1.1: Write the migration**

```sql
-- Migration: 20260503000002_worker_commands.sql
-- Workers Panel: command bus for dashboard-initiated worker kills.

CREATE TABLE public.worker_commands (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id    text        NOT NULL,
  command      text        NOT NULL CHECK (command IN ('kill')),
  issued_at    timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX worker_commands_pending_idx
  ON public.worker_commands (worker_id)
  WHERE processed_at IS NULL;

COMMENT ON TABLE public.worker_commands IS
  'Command bus for dashboard → worker signals. Worker polls for its own pending rows and executes them.';

-- Service-role only. Explicit deny-all policy matches the worker_instances pattern.
ALTER TABLE public.worker_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny all" ON public.worker_commands
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);
```

- [ ] **Step 1.2: Apply migration via Supabase MCP**

Use the `mcp__supabase-conductor__apply_migration` tool with the SQL above.

- [ ] **Step 1.3: Verify table exists**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'worker_commands'
ORDER BY ordinal_position;
```

Expected: id (uuid), worker_id (text), command (text), issued_at (timestamptz), processed_at (timestamptz).

- [ ] **Step 1.4: Regenerate TypeScript types**

Use `mcp__supabase-conductor__generate_typescript_types` and write the output to `packages/db/src/types.gen.ts`. This is required — without it `db.from("worker_commands")` will be typed as `never` and Tasks 2, 3, and 7 will not compile.

- [ ] **Step 1.5: Commit**

```bash
cd C:/MisProyectos/Armagedon/production/conductor
git add supabase/migrations/20260503000002_worker_commands.sql packages/db/src/types.gen.ts
git commit -m "feat(db): add worker_commands table and regenerate types"
```

---

## Task 2 — Shared types

**Files:**
- Create: `apps/web/lib/types/workers.ts`

Shared in a dedicated file so both the API route and the client-side hook can import without the hook touching the server-only `createServiceClient` import tree.

- [ ] **Step 2.1: Write the types file**

```typescript
export type WorkerStatus = "green" | "yellow" | "red";

export interface WorkerRow {
  id: string;
  hostname: string | null;
  pid: number | null;
  started_at: string;
  last_seen_at: string;
  status: WorkerStatus;
}

export interface WorkersResponse {
  workers: WorkerRow[];
}
```

- [ ] **Step 2.2: Commit**

```bash
git add apps/web/lib/types/workers.ts
git commit -m "feat(types): add shared WorkerRow / WorkerStatus types"
```

---

## Task 3 — API route: GET /api/workers

**Files:**
- Create: `apps/web/app/api/workers/route.ts`

Uses `createServiceClient()` (not `user.db`) because `worker_instances` has deny-all RLS — it is service-role only. Auth is still required so only logged-in users can call it.

- [ ] **Step 3.1: Write the route**

```typescript
import { defineRoute, respond, respondError } from "@/lib/api";
import type { WorkerRow, WorkersResponse } from "@/lib/types/workers";
import { createServiceClient } from "@conductor/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_YELLOW_MS = 2 * 60 * 1000; // 2 min
const STALE_RED_MS   = 5 * 60 * 1000; // 5 min

export const GET = defineRoute<undefined, undefined>(
  { rateLimit: "general" },
  async ({ traceId }) => {
    const db = createServiceClient();
    const { data, error } = await db
      .from("worker_instances")
      .select("id, hostname, pid, started_at, last_seen_at")
      .order("started_at", { ascending: false });

    if (error !== null) {
      return respondError("internal", "Failed to load workers", {
        traceId,
        details: { code: error.code },
      });
    }

    const now = Date.now();
    const workers: WorkerRow[] = (data ?? []).map((w) => {
      const ageMsHB = now - new Date(w.last_seen_at).getTime();
      const status =
        ageMsHB <= STALE_YELLOW_MS ? "green" :
        ageMsHB <= STALE_RED_MS   ? "yellow" : "red";
      return { ...w, status } as WorkerRow;
    });

    return respond<WorkersResponse>({ workers }, { traceId });
  },
);
```

- [ ] **Step 3.2: Commit**

```bash
git add apps/web/app/api/workers/route.ts
git commit -m "feat(api): add GET /api/workers endpoint"
```

---

## Task 4 — API route: POST /api/workers/[id]/kill

**Files:**
- Create: `apps/web/app/api/workers/[id]/kill/route.ts`

- [ ] **Step 4.1: Write the route**

```typescript
import { defineRoute, respond, respondError } from "@/lib/api";
import { createServiceClient } from "@conductor/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

/**
 * POST /api/workers/:id/kill
 *
 * Inserts a 'kill' command into worker_commands. The target worker polls
 * this table every ~3 s and will call gracefulShutdown() when it claims the row.
 */
export const POST = defineRoute<undefined, undefined, Params>(
  { rateLimit: "mutation" },
  async ({ traceId, params }) => {
    const db = createServiceClient();

    // Verify worker exists before enqueuing a command.
    const { data: worker, error: fetchError } = await db
      .from("worker_instances")
      .select("id")
      .eq("id", params.id)
      .maybeSingle();

    if (fetchError !== null) {
      return respondError("internal", "Failed to look up worker", { traceId });
    }
    if (worker === null) {
      return respondError("not_found", "Worker not found", { traceId });
    }

    const { error: insertError } = await db.from("worker_commands").insert({
      worker_id: params.id,
      command: "kill",
    });

    if (insertError !== null) {
      return respondError("internal", "Failed to enqueue kill command", {
        traceId,
        details: { code: insertError.code },
      });
    }

    return respond<{ queued: boolean }>({ queued: true }, { traceId });
  },
);
```

- [ ] **Step 4.2: Commit**

```bash
git add apps/web/app/api/workers/[id]/kill/route.ts
git commit -m "feat(api): add POST /api/workers/:id/kill endpoint"
```

---

## Task 5 — React Query key + hook

**Files:**
- Modify: `apps/web/lib/react-query/keys.ts`
- Create: `apps/web/hooks/use-workers.ts`

- [ ] **Step 5.1: Add workers key to qk**

In `apps/web/lib/react-query/keys.ts`, add after the `insights` block (before the closing `} as const`):

```typescript
  workers: {
    all: () => ["workers"] as const,
    list: () => ["workers", "list"] as const,
  },
```

- [ ] **Step 5.2: Write the hook**

```typescript
"use client";
import type { WorkerRow, WorkersResponse } from "@/lib/types/workers";
import { apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type { WorkerRow };

export function useWorkers() {
  return useQuery<WorkersResponse>({
    queryKey: qk.workers.list(),
    queryFn: ({ signal }) => apiClient.get<WorkersResponse>("/api/workers", { signal }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useKillWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workerId: string) =>
      apiClient.post<{ queued: boolean }>(`/api/workers/${workerId}/kill`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workers.all() });
    },
  });
}
```

- [ ] **Step 5.3: Commit**

```bash
git add apps/web/lib/react-query/keys.ts apps/web/hooks/use-workers.ts
git commit -m "feat(hooks): add useWorkers + useKillWorker hooks"
```

---

## Task 6 — WorkersPanel component

**Files:**
- Create: `apps/web/app/dashboard/_components/workers-panel.tsx`

Status color mapping (Tailwind): green = `emerald-500`, yellow = `amber-500`, red = `red-500`.
Use `formatDuration` from `@/lib/ui/format` for uptime.

- [ ] **Step 6.1: Write the component**

```typescript
"use client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useKillWorker, useWorkers } from "@/hooks/use-workers";
import type { WorkerRow, WorkerStatus } from "@/lib/types/workers";
import { formatDuration } from "@/lib/ui/format";
import { ServerIcon, XCircleIcon } from "lucide-react";

const STATUS_DOT: Record<WorkerStatus, string> = {
  green:  "bg-emerald-500",
  yellow: "bg-amber-500",
  red:    "bg-red-500",
};

const STATUS_LABEL: Record<WorkerStatus, string> = {
  green:  "Activo",
  yellow: "Lento",
  red:    "Zombie",
};

function relativeTime(isoStr: string): string {
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `hace ${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `hace ${mins}min`;
  return `hace ${Math.floor(mins / 60)}h`;
}

function WorkerTableRow({ w, isPending, onKill }: {
  w: WorkerRow;
  isPending: boolean;
  onKill: (id: string) => void;
}) {
  return (
    <tr className="border-b last:border-0">
      <td className="p-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block size-2.5 rounded-full ${STATUS_DOT[w.status]}`}
            aria-hidden="true"
          />
          <span className="text-sm">{STATUS_LABEL[w.status]}</span>
        </div>
      </td>
      <td className="p-3 font-mono text-xs">
        <div>{w.hostname ?? "—"}</div>
        <div className="text-muted-foreground">PID {w.pid ?? "—"}</div>
      </td>
      <td className="p-3 text-sm text-muted-foreground">
        {formatDuration(Date.now() - new Date(w.started_at).getTime())}
      </td>
      <td className="p-3 text-sm text-muted-foreground">
        {relativeTime(w.last_seen_at)}
      </td>
      <td className="p-3 text-right">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-destructive hover:text-destructive"
          disabled={isPending}
          onClick={() => onKill(w.id)}
          aria-label={`Matar worker ${w.id}`}
        >
          <XCircleIcon className="size-3.5" />
          Matar
        </Button>
      </td>
    </tr>
  );
}

export function WorkersPanel() {
  const { data, isLoading } = useWorkers();
  const kill = useKillWorker();

  const workers = data?.workers ?? [];
  const onlineCount = workers.filter((w) => w.status === "green").length;

  return (
    <section aria-label="Workers" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold tracking-tight">Workers</h2>
        <Badge
          variant={onlineCount > 0 ? "default" : "destructive"}
          className="gap-1.5"
        >
          <span
            className={`inline-block size-2 rounded-full ${onlineCount > 0 ? "bg-emerald-400" : "bg-red-400"}`}
            aria-hidden="true"
          />
          {isLoading ? "…" : `${onlineCount} en línea`}
        </Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : workers.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-muted-foreground">
              <ServerIcon className="size-8 opacity-30" />
              <p className="text-sm">No hay workers registrados.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="p-3 text-left">Estado</th>
                  <th className="p-3 text-left">Host / PID</th>
                  <th className="p-3 text-left">Corriendo desde</th>
                  <th className="p-3 text-left">Último heartbeat</th>
                  <th className="p-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((w) => (
                  <WorkerTableRow
                    key={w.id}
                    w={w}
                    isPending={kill.isPending}
                    onKill={(id) => kill.mutate(id)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
```

- [ ] **Step 6.2: Commit**

```bash
git add apps/web/app/dashboard/_components/workers-panel.tsx
git commit -m "feat(dashboard): add WorkersPanel component"
```

---

## Task 7 — Dashboard page integration

**Files:**
- Modify: `apps/web/app/dashboard/page.tsx`

- [ ] **Step 7.1: Add WorkersPanel import and render**

Add to the import block at the top:

```typescript
import { WorkersPanel } from "./_components/workers-panel";
```

Add as a new section between the KPI `</section>` and the `{activeRuns.length > 0 && ...}` block:

```tsx
<WorkersPanel />
```

- [ ] **Step 7.2: Commit**

```bash
git add apps/web/app/dashboard/page.tsx
git commit -m "feat(dashboard): integrate WorkersPanel into main dashboard page"
```

---

## Task 8 — Worker: poll worker_commands and respond to kill

**Files:**
- Modify: `apps/worker/src/index.ts`

Four changes: (a) add `checkForKillCommand` function with atomic claim; (b) add `killCommandTimer` state variable; (c) clear it in `gracefulShutdown` alongside `workerHeartbeatTimer`; (d) move `worker_instances` row delete to after `Promise.allSettled`.

- [ ] **Step 8.1: Add killCommandTimer state variable**

After the existing `let workerHeartbeatTimer: ReturnType<typeof setInterval> | null = null;` line (~line 193), add:

```typescript
let killCommandTimer: ReturnType<typeof setInterval> | null = null;
```

- [ ] **Step 8.2: Add checkForKillCommand function**

After the existing `updateWorkerHeartbeat` function (~line 186), add:

```typescript
async function checkForKillCommand(db: ReturnType<typeof createClient<Database>>): Promise<void> {
  if (shuttingDown) return;

  // Atomic CAS: UPDATE WHERE processed_at IS NULL and RETURNING ensures
  // only one caller claims the row even if two ticks fire concurrently.
  const { data, error } = await db
    .from("worker_commands")
    .update({ processed_at: new Date().toISOString() })
    .eq("worker_id", WORKER_ID)
    .is("processed_at", null)
    .eq("command", "kill")
    .select("id")
    .maybeSingle();

  if (error !== null) {
    logger.warn({ err: error }, "worker kill-command poll failed");
    return;
  }
  if (data === null) return;

  logger.warn({ commandId: data.id }, "kill command received — shutting down");
  gracefulShutdown("kill_command");
}
```

- [ ] **Step 8.3: Clear killCommandTimer in gracefulShutdown**

Inside `gracefulShutdown`, in the `shutdown` async function where `workerHeartbeatTimer` is cleared (~line 210), add clearing for `killCommandTimer` right next to it:

```typescript
if (killCommandTimer !== null) {
  clearInterval(killCommandTimer);
  killCommandTimer = null;
}
```

- [ ] **Step 8.4: Move worker_instances cleanup to after Promise.allSettled**

Still inside the `shutdown` async function, move the cleanup to after the `await Promise.race(...)` line and before `process.exit(0)`:

```typescript
// Remove this instance from the registry so the dashboard stops showing it.
// Placed after runs settle so no in-flight heartbeat tick races against us.
try {
  const cleanupClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  await cleanupClient.from("worker_instances").delete().eq("id", WORKER_ID);
} catch {
  // best-effort — row will appear zombie via last_seen_at staleness instead
}

logger.info("all runs finished or timed out, exiting");
process.exit(0);
```

Remove the existing `logger.info("all runs finished or timed out, exiting")` + `process.exit(0)` that were there before since this replaces them.

- [ ] **Step 8.5: Start kill-command poller in the Boot section**

After `workerHeartbeatTimer = setInterval(...)` is set (around line 262), add:

```typescript
// Poll for dashboard-issued kill commands at the same cadence as run polling.
{
  const killCommandClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  killCommandTimer = setInterval(() => {
    void checkForKillCommand(killCommandClient).catch((err: unknown) => {
      logger.warn({ err }, "kill command check threw unexpectedly");
    });
  }, 3_000);
}
```

- [ ] **Step 8.6: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat(worker): poll worker_commands table and respond to kill signal"
```

---

## Task 9 — Push to main

- [ ] **Step 9.1: Final push**

```bash
git push origin main
```

---

## Testing checklist

- [ ] Worker panel appears on dashboard with real data after starting the worker
- [ ] Worker row shows green dot (heartbeat < 2 min)
- [ ] After clicking "Matar" on an active worker: row disappears (worker_instances row deleted on shutdown) or turns red within 30 s if shutdown takes longer
- [ ] With no workers running: panel shows "No hay workers registrados"
- [ ] Badge shows "X en línea" reflecting correct green-status count
- [ ] Dashboard panel auto-refreshes every 30 s without user action
- [ ] Zombie worker (> 5 min without heartbeat) shows red dot labeled "Zombie"
- [ ] TypeScript compiles without errors (`pnpm tsc --noEmit` in monorepo root)

---

## Key implementation notes

- `worker_instances` and `worker_commands` both have deny-all RLS — API routes **must** use `createServiceClient()`, never `user.db`.
- `WorkerRow` / `WorkerStatus` live in `apps/web/lib/types/workers.ts` (not in the route file) so the client-side hook can import them without pulling in server-only imports.
- The kill-command claim is a single atomic `UPDATE ... WHERE processed_at IS NULL RETURNING id` — no separate SELECT, no TOCTOU race.
- `killCommandTimer` is cleared in `gracefulShutdown` like `workerHeartbeatTimer`, preventing spurious network calls during the drain window.
- `worker_instances` row is deleted after `Promise.allSettled` to avoid racing against any in-flight heartbeat update.

# Fase 11 — UI Dashboard: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the live, premium dashboard that lets a single user watch Conductor runs in real time — KPIs, run lists, the run-detail "joya" page (progress timeline + virtualized log stream + token/cost meters + tool call viewer + guardian feed + control buttons + approval modal), settings, all wired to existing API routes via React Query and to Supabase Realtime for live updates.

**Architecture:** Next.js 16 App Router + RSC for static shells, client components for interactive panels. Server-state via `@tanstack/react-query` (single QueryClient provider). Live updates via a `useRunRealtime` hook that subscribes to `run_events` and `output_chunks` Supabase channels and merges payloads into the React Query cache (no extra refetches). Optimistic UI for control actions with toast rollback on failure. Framer Motion for transitions, virtualization for log streams (`@tanstack/react-virtual`), and `cmdk` for the global palette. Dark-first theming via existing `next-themes` + Tailwind v4.

**Tech Stack:** Next.js 16.2 / React 19 / TypeScript strict / Tailwind v4 / shadcn (style: `base-nova`) / framer-motion 12 / @tanstack/react-query 5 / @tanstack/react-virtual / @supabase/ssr (already present via `@conductor/db`) / sonner / cmdk / react-markdown + remark-gfm + rehype-highlight / canvas-confetti / lucide-react / Vitest + React Testing Library / Playwright (E2E).

---

## 📋 Pre-flight (READ BEFORE STARTING)

**Project conventions (from `conductor/CLAUDE.md` and `apps/web/AGENTS.md`):**
1. **No worktrees, no feature branches** — every commit goes to `main` directly.
2. **Conventional commits** — `feat(ui): ...`, `fix(ui): ...`, `chore(ui): ...`. Scope `ui` (or sub-scope: `ui/dashboard`, `ui/realtime`, `ui/settings`).
3. **Next.js 16 is NOT the Next.js in your training data.** Before writing route handlers or App Router code, run:
   ```bash
   ls C:/MisProyectos/Armagedon/production/conductor/apps/web/node_modules/next/dist/docs/
   ```
   Read the relevant guide (especially: server vs client components, `params` is a Promise, dynamic rendering rules).
4. **shadcn style is `base-nova`** — newer than the docs you may have. The `Button` accepts a `render={<Link/>}` prop instead of `asChild`. The `size` prop has values like `icon-sm`. Consult existing components in `apps/web/components/ui/` and `apps/web/app/dashboard/runs/[id]/decisions/page.tsx` for current patterns.
5. **Auth is dev-mode** — `getAuthedUser()` returns hardcoded `DEV_USER_ID`. Don't add login flows. Do NOT remove the helper.
6. **All API routes already exist** — see inventory in §0.1. We consume them; we don't duplicate logic.
7. **DB types canonical source:** `@conductor/db` (`packages/db/src/index.ts`) re-exports row types. Use them. Don't re-derive.
8. **State strategy:** React Query for **server state** (lists, runs, executions, decisions). Zustand reserved for purely client state if needed (e.g., palette open, user preferences not persisted to DB). Right now we don't need Zustand for Phase 11 — only add it if a concrete need appears.
9. **Test runner:** Vitest with `jsdom` environment for component tests. Existing `vitest.config.ts` is `node`-only — we extend it (Task 1.5).
10. **Type-check before committing:** `pnpm --filter web typecheck` must pass. Use Biome (`pnpm --filter web lint` if configured) for formatting.

### 0.1 — Existing API contract reference (consume, don't duplicate)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/plans` | GET, POST | List/create plans |
| `/api/plans/:id` | GET, PATCH, DELETE | Plan detail/edit |
| `/api/plans/:id/prompts` | GET, POST | Prompts in plan |
| `/api/plans/:id/prompts/reorder` | POST | Reorder prompts |
| `/api/plans/:id/runs` | GET, POST | Trigger run |
| `/api/runs` | GET | List runs (filterable, paginated cursor) |
| `/api/runs/:id` | GET | Run + executions + plan |
| `/api/runs/:id/{pause,resume,cancel,retry}` | POST | Lifecycle controls |
| `/api/runs/:id/{skip-prompt,approve-prompt}` | POST | Prompt-level controls |
| `/api/runs/:id/rollback` | POST | Rollback to checkpoint |
| `/api/runs/:id/stream` | GET | SSE fallback for events |
| `/api/runs/:id/logs` | GET | Paginated logs |
| `/api/runs/:id/decisions` | GET | Guardian decisions feed |
| `/api/runs/:id/diff/:promptId` | GET | Diff vs checkpoint |
| `/api/runs/:id/guardian/decisions` (+ POST override) | GET | Guardian decisions admin |
| `/api/runs/:id/guardian/metrics` | GET | Guardian aggregates |
| `/api/settings` | GET, PATCH | User settings |
| `/api/system/check-path` | POST | Validate working dir |

**Response envelope:** Success bodies are raw JSON (no wrapper). Error bodies follow `{ error: ApiErrorCode, message, details?, traceId }` (`apps/web/lib/api/respond.ts`). Every response carries `x-trace-id` header — surface it on toasts when actions fail.

**Pagination:** List endpoints return `{ <items>: [...], nextCursor?: string }`. Use `useInfiniteQuery` for tables.

### 0.2 — Database schema reference

Tables relevant to UI (from `@conductor/db` types):
- `plans` (id, name, description, tags, is_template, default_settings, default_working_dir, created_at, user_id)
- `prompts` (id, plan_id, order_index, filename, title, content, content_hash, frontmatter)
- `runs` (id, plan_id, working_dir, status, started_at, finished_at, current_prompt_index, run_branch, total_cost_usd, total_tokens jsonb)
- `prompt_executions` (id, run_id, prompt_id, status, attempt, started_at, finished_at, session_id, checkpoint_sha, cost_usd, tokens jsonb, error jsonb)
- `run_events` (id, run_id, sequence, event_type, payload jsonb, prompt_execution_id, created_at) — **realtime feed**
- `output_chunks` (id, prompt_execution_id, channel, content, sequence, created_at) — **log stream feed**
- `guardian_decisions` (id, prompt_execution_id, question_detected, reasoning, decision, confidence, strategy, decided_at, reviewed_by_human, overridden_by_human)
- `settings` (user_id, ...preferences)

`RunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled"`
`ExecutionStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "rolled_back" | "awaiting_approval"`

### 0.3 — File structure to be created

```
apps/web/
├── app/
│   ├── providers.tsx                                NEW   # global providers wrapper
│   └── dashboard/
│       ├── layout.tsx                                MOD   # add topbar + collapsible sidebar
│       ├── page.tsx                                  NEW   # home: KPIs + active runs + recent
│       ├── _components/
│       │   ├── sidebar.tsx                           NEW
│       │   ├── topbar.tsx                            NEW
│       │   ├── command-palette.tsx                   NEW   # cmdk
│       │   ├── theme-toggle.tsx                      NEW
│       │   ├── notification-bell.tsx                 NEW
│       │   ├── kpi-card.tsx                          NEW
│       │   ├── active-run-card.tsx                   NEW
│       │   ├── recent-runs-list.tsx                  NEW
│       │   ├── claude-auth-status.tsx                NEW
│       │   └── system-status-indicator.tsx           NEW
│       ├── runs/
│       │   ├── page.tsx                              NEW   # table of all runs
│       │   ├── _components/
│       │   │   ├── runs-table.tsx                    NEW
│       │   │   ├── run-status-badge.tsx              NEW
│       │   │   └── runs-filter-bar.tsx               NEW
│       │   └── [id]/
│       │       ├── page.tsx                          NEW   # the joya — live run detail
│       │       ├── _components/
│       │       │   ├── run-header.tsx                NEW
│       │       │   ├── run-duration.tsx              NEW   # ticking timer
│       │       │   ├── progress-timeline.tsx         NEW
│       │       │   ├── prompt-card.tsx               NEW
│       │       │   ├── live-log-stream.tsx           NEW   # virtual scroll
│       │       │   ├── log-line.tsx                  NEW
│       │       │   ├── token-meter.tsx               NEW
│       │       │   ├── cost-meter.tsx                NEW
│       │       │   ├── tool-call-viewer.tsx          NEW
│       │       │   ├── tool-call-bash.tsx            NEW
│       │       │   ├── tool-call-edit.tsx            NEW
│       │       │   ├── tool-call-read.tsx            NEW
│       │       │   ├── tool-call-generic.tsx         NEW
│       │       │   ├── guardian-feed-panel.tsx       NEW
│       │       │   ├── system-health-panel.tsx       NEW
│       │       │   ├── control-buttons.tsx           NEW
│       │       │   ├── approval-modal.tsx            NEW
│       │       │   ├── live-cursor-panel.tsx         NEW
│       │       │   └── completion-confetti.tsx       NEW
│       │       ├── decisions/page.tsx                EXISTS (Phase 08)
│       │       └── diff/[promptId]/...               EXISTS (Phase 08)
│       └── settings/
│           ├── page.tsx                              NEW
│           └── _components/
│               └── settings-form.tsx                 NEW
├── components/
│   └── ui/
│       ├── tooltip.tsx                               NEW (shadcn add)
│       ├── progress.tsx                              NEW (shadcn add)
│       ├── skeleton.tsx                              NEW (shadcn add)
│       ├── command.tsx                               NEW (shadcn add)
│       ├── sheet.tsx                                 NEW (shadcn add)
│       ├── separator.tsx                             NEW (shadcn add)
│       ├── avatar.tsx                                NEW (shadcn add)
│       ├── popover.tsx                               NEW (shadcn add)
│       ├── switch.tsx                                NEW (shadcn add)
│       └── label.tsx                                 NEW (shadcn add)
├── hooks/
│   ├── use-run-realtime.ts                           NEW   # supabase channel + RQ cache merge
│   ├── use-runs-list.ts                              NEW
│   ├── use-run-detail.ts                             NEW
│   ├── use-run-actions.ts                            NEW   # mutations: pause/resume/...
│   ├── use-active-runs.ts                            NEW
│   ├── use-dashboard-kpis.ts                         NEW
│   ├── use-prompt-logs.ts                            NEW   # virtualized log feed
│   ├── use-guardian-feed.ts                          NEW
│   ├── use-keyboard-shortcuts.ts                     NEW
│   └── __tests__/
│       └── use-run-actions.test.ts                   NEW
├── lib/
│   ├── api-client.ts                                 NEW   # fetch wrapper, traceId surfacing
│   ├── react-query/
│   │   ├── client.ts                                 NEW   # QueryClient factory
│   │   ├── keys.ts                                   NEW   # query-key factory
│   │   └── provider.tsx                              NEW
│   ├── realtime/
│   │   ├── client.ts                                 NEW   # browser Supabase client singleton
│   │   ├── channels.ts                               NEW   # channel name builders
│   │   └── event-handlers.ts                         NEW   # pure RunEvent → cache patch fns
│   ├── ui/
│   │   ├── format.ts                                 NEW   # tokens, cost, duration, bytes
│   │   ├── status.ts                                 NEW   # status → color/label map
│   │   ├── animations.ts                             NEW   # framer-motion variants
│   │   └── __tests__/
│   │       ├── format.test.ts                        NEW
│   │       └── status.test.ts                        NEW
│   ├── tool-parsing/
│   │   ├── parse-tool-event.ts                       NEW
│   │   └── __tests__/
│   │       └── parse-tool-event.test.ts              NEW
│   └── env-public.ts                                 NEW   # validated NEXT_PUBLIC_* vars
├── middleware.ts                                     NEW   # auth gate (dev-mode passthrough)
├── e2e/
│   ├── playwright.config.ts                          NEW
│   ├── dashboard.spec.ts                             NEW
│   └── run-detail.spec.ts                            NEW
└── vitest.config.ts                                  MOD   # add jsdom env for component tests
```

### 0.4 — Lote roadmap

| Lote | Title | Tasks | Independent? |
|---|---|---|---|
| **A** | Foundations (incl. realtime enablement migration) | 1.0–1.11 | No (everything depends on this) |
| **B** | Layout & navigation | 2.1–2.6 | After A |
| **C** | Home + Runs list | 3.1–3.5 | After A, B (parallelizable internally) |
| **D** | Run detail (la joya) | 4.1–4.14 | After A, B (parallelizable internally for sub-components) |
| **E** | Settings + polish | 5.1–5.7 | After A, B |
| **F** | E2E + Lighthouse + final pass | 6.1–6.5 | After all |

### 0.5 — Pre-execution decisions (LOCKED)

These are pinned to avoid drift mid-build:

- **`/api/runs/:id` response shape:** flat-spread `Run & { executions: PromptExecution[]; plan: Plan | null }`. **Do NOT** wrap in `{ run, executions, plan }`. The cache type and event handlers must match.
- **Realtime auth strategy:** **Option A** — add a dev-only RLS migration granting `anon` role read access to realtime tables. Tagged `_dev_only_` and listed in §0.6 "Tech debt" so multi-user later removes it. Rationale: cheapest path to realtime-correct UI in single-user dev, avoids hacking auth flow we'll redo for multi-user.
- **Cache-merge race protection:** every `RunDetailCache` carries `_lastAppliedSequence: number`. `applyEvent` ignores events with `sequence <= _lastAppliedSequence`. On RQ refetch settle, server's max sequence is read from the bundled `recentEvents` (we'll extend `/api/runs/:id` minimally if needed) or from a dedicated `?since=<seq>` replay query — see Task 4.1.
- **Cross-component fan-out:** custom in-memory event bus in `lib/realtime/event-bus.ts` (typed pub-sub), NOT `window.dispatchEvent`. Better for tests, types, and SSR safety.
- **Commit scopes:** existing repo uses `feat(api)`, `feat(checkpoint)`, `chore(web)`. We use **`feat(ui)`** as the umbrella scope, with sub-scopes `feat(ui/dashboard)`, `feat(ui/realtime)`, `feat(ui/runs)` when meaningful.

### 0.6 — Tech debt items spawned by this phase

Track these now so they don't get lost. Open as separate tickets after Phase 11 ships.

1. **Revert dev-only RLS for `anon`** when multi-user auth lands. Migration filename includes `_dev_only_` for grep-ability.
2. **Replace browser dev-user with real Supabase auth session** so RLS + Realtime authorize via JWT.
3. **Server-side KPIs endpoint** `/api/dashboard/kpis` if client-side aggregation over `/api/runs?limit=200` becomes slow.
4. **Replace SSE fallback `/api/runs/:id/stream`** consumers (none in Phase 11, but it exists) with Realtime once auth is real.

**Commit cadence:** every Task = at minimum one commit. Sub-steps may share a commit if tightly coupled. Type-check passes before every commit.

---

# Lote A — Foundations

## Task 1.0: Realtime enablement migration (CRITICAL — do this first)

**Files:** `supabase/migrations/20260430000002_realtime_publication_and_dev_rls.sql`

**Problem this fixes:** `postgres_changes` requires (a) the table to be a member of the `supabase_realtime` publication and (b) the subscriber's role to satisfy RLS. Today, neither of `run_events` / `output_chunks` / `runs` / `prompt_executions` / `guardian_decisions` is in the publication, AND the existing RLS policies grant `TO authenticated` only — the browser client has no auth session and uses the `anon` role. Without this migration, the realtime hook will subscribe successfully (returns `SUBSCRIBED`) and then receive ZERO events.

- [ ] **Step 1: Confirm current state**
  ```bash
  cd C:/MisProyectos/Armagedon/production/conductor
  pnpm supabase db reset || true   # ensure local DB is in known state
  ```
  Or, against a running local stack:
  ```bash
  pnpm supabase start
  ```
- [ ] **Step 2: Write migration**
  ```sql
  -- Migration: 20260430000002_realtime_publication_and_dev_rls.sql
  -- Phase 11: enable Supabase Realtime on the tables the dashboard subscribes to,
  -- and TEMPORARILY grant the anon role read access for single-user dev mode.
  --
  -- ⚠️ REVERT BEFORE MULTI-USER: the `_dev_only_` policies below give the anon
  -- role SELECT access to ALL rows in the listed tables. They exist solely so
  -- the browser client (which has no auth session yet) can subscribe to
  -- realtime events. Drop them as part of the multi-user migration.

  -- ─── 1. Add tables to the supabase_realtime publication ──────────────────────
  ALTER PUBLICATION supabase_realtime ADD TABLE
    public.runs,
    public.prompt_executions,
    public.run_events,
    public.output_chunks,
    public.guardian_decisions;

  -- REPLICA IDENTITY FULL ensures DELETE/UPDATE payloads carry the OLD row.
  -- We mainly INSERT, but cheap insurance against future filters needing it.
  ALTER TABLE public.runs               REPLICA IDENTITY FULL;
  ALTER TABLE public.prompt_executions  REPLICA IDENTITY FULL;
  ALTER TABLE public.run_events         REPLICA IDENTITY FULL;
  ALTER TABLE public.output_chunks      REPLICA IDENTITY FULL;
  ALTER TABLE public.guardian_decisions REPLICA IDENTITY FULL;

  -- ─── 2. Dev-only anon SELECT policies ────────────────────────────────────────
  CREATE POLICY "_dev_only_runs_select_anon"               ON public.runs
    FOR SELECT TO anon USING (true);
  CREATE POLICY "_dev_only_prompt_executions_select_anon"  ON public.prompt_executions
    FOR SELECT TO anon USING (true);
  CREATE POLICY "_dev_only_run_events_select_anon"         ON public.run_events
    FOR SELECT TO anon USING (true);
  CREATE POLICY "_dev_only_output_chunks_select_anon"      ON public.output_chunks
    FOR SELECT TO anon USING (true);
  CREATE POLICY "_dev_only_guardian_decisions_select_anon" ON public.guardian_decisions
    FOR SELECT TO anon USING (true);
  ```
- [ ] **Step 3: Apply locally**
  ```bash
  pnpm supabase db push    # or: pnpm supabase migration up
  ```
- [ ] **Step 4: Smoke test from psql** (proves realtime publication membership)
  ```bash
  pnpm supabase db query "SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY tablename;"
  ```
  Expected: rows for `runs`, `prompt_executions`, `run_events`, `output_chunks`, `guardian_decisions`.
- [ ] **Step 5: Smoke test from a tiny browser script** (proves anon read works)
  Open `pnpm --filter web dev`, in a browser console:
  ```javascript
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(window.location.origin /* or the supabase URL */, "<anon-key>");
  const { data, error } = await sb.from("runs").select("id").limit(1);
  console.log({ data, error });
  ```
  Expected: `data` has 0+ rows, `error === null`. (If `error` is present, RLS is still blocking — fix before continuing.)
- [ ] **Step 6: Commit**
  ```bash
  git add supabase/migrations/20260430000002_realtime_publication_and_dev_rls.sql
  git commit -m "feat(db): enable realtime publication and dev-mode anon read policies for fase 11"
  ```

**Note:** if you discover at this step that `getAuthedUser` is going to be reworked to use a real Supabase auth session before Phase 11 ships, abort this migration and pivot to that work first — but as of plan-write date that's deferred. Decision logged in §0.6.

---

## Task 1.1: Add missing dependencies

**Files:** `apps/web/package.json` (auto-modified by pnpm)

- [ ] **Step 1: Install runtime deps**
  ```bash
  pnpm --filter web add @tanstack/react-query @tanstack/react-query-devtools @tanstack/react-virtual cmdk react-markdown remark-gfm rehype-highlight canvas-confetti
  ```
- [ ] **Step 2: Install dev deps for component tests**
  ```bash
  pnpm --filter web add -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @vitejs/plugin-react happy-dom @types/canvas-confetti
  ```
- [ ] **Step 3: Verify install**
  Run: `pnpm --filter web typecheck`
  Expected: PASS (no new errors).
- [ ] **Step 4: Commit**
  ```bash
  git add apps/web/package.json pnpm-lock.yaml
  git commit -m "chore(ui): add react-query, react-virtual, cmdk, markdown deps for fase 11"
  ```

---

## Task 1.2: Add missing shadcn primitives

**Files:** `apps/web/components/ui/{tooltip,progress,skeleton,command,sheet,separator,avatar,popover,switch,label}.tsx`

- [ ] **Step 1: Run shadcn add (one batch)**
  ```bash
  cd apps/web && pnpm dlx shadcn@latest add tooltip progress skeleton command sheet separator avatar popover switch label
  ```
  If the CLI prompts for style — accept `base-nova` (matches `components.json`).
- [ ] **Step 2: Verify each file exists and exports a default-styled component**
  ```bash
  ls apps/web/components/ui/
  ```
- [ ] **Step 3: Type-check**
  Run: `pnpm --filter web typecheck`
- [ ] **Step 4: Commit**
  ```bash
  git add apps/web/components/ui/
  git commit -m "feat(ui): add shadcn primitives (tooltip, progress, skeleton, command, sheet, separator, avatar, popover, switch, label)"
  ```

---

## Task 1.3: Public env validation

**Files:** `apps/web/lib/env-public.ts` (new)

- [ ] **Step 1: Write file**
  ```typescript
  // apps/web/lib/env-public.ts
  /**
   * Validated NEXT_PUBLIC_* env. Throws at module load if any are missing,
   * so a misconfigured deploy fails loud instead of silently going down a
   * "supabase URL undefined" rabbit hole at runtime.
   */
  function require(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
  }

  export const PUBLIC_ENV = {
    SUPABASE_URL: require("NEXT_PUBLIC_SUPABASE_URL"),
    SUPABASE_ANON_KEY: require("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  } as const;
  ```
- [ ] **Step 2: Type-check + commit**
  ```bash
  git add apps/web/lib/env-public.ts
  git commit -m "feat(ui): validated public env loader"
  ```

---

## Task 1.4: API client wrapper (TDD)

**Files:** `apps/web/lib/api-client.ts`, `apps/web/lib/__tests__/api-client.test.ts`

The wrapper centralizes:
- JSON serialization
- Error normalization (parses `ApiErrorBody`)
- Surfaces `traceId` so toasts can include it
- AbortSignal support (for React Query)

- [ ] **Step 1: Vitest config — add jsdom env**
  Modify `apps/web/vitest.config.ts`:
  ```typescript
  import react from "@vitejs/plugin-react";
  import { defineConfig } from "vitest/config";
  import path from "node:path";

  export default defineConfig({
    plugins: [react()],
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./vitest.setup.ts"],
      include: ["**/*.{test,spec}.{ts,tsx}"],
      exclude: ["**/node_modules/**", "**/.next/**", "**/e2e/**"],
    },
    resolve: { alias: { "@": path.resolve(__dirname) } },
  });
  ```
  And create `apps/web/vitest.setup.ts`:
  ```typescript
  import "@testing-library/jest-dom/vitest";
  ```
- [ ] **Step 2: Write failing test**
  ```typescript
  // apps/web/lib/__tests__/api-client.test.ts
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { apiClient, ApiClientError } from "../api-client";

  describe("apiClient", () => {
    beforeEach(() => { vi.restoreAllMocks(); });

    it("returns parsed JSON on 2xx", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
        JSON.stringify({ id: "x" }),
        { status: 200, headers: { "x-trace-id": "tr-1" } },
      )));
      const res = await apiClient.get<{ id: string }>("/api/plans/x");
      expect(res).toEqual({ id: "x" });
    });

    it("throws ApiClientError with code+traceId on 4xx", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
        JSON.stringify({ error: "not_found", message: "Run not found", traceId: "tr-2" }),
        { status: 404, headers: { "x-trace-id": "tr-2" } },
      )));
      await expect(apiClient.get("/api/runs/missing")).rejects.toMatchObject({
        code: "not_found", traceId: "tr-2", status: 404,
      });
    });
  });
  ```
- [ ] **Step 3: Run test → expect FAIL** (`pnpm --filter web test api-client`)
- [ ] **Step 4: Write minimal implementation**
  ```typescript
  // apps/web/lib/api-client.ts
  import type { ApiErrorBody, ApiErrorCode } from "@/lib/api/respond";

  export class ApiClientError extends Error {
    constructor(
      readonly code: ApiErrorCode | "network",
      readonly status: number,
      message: string,
      readonly traceId: string,
      readonly details?: unknown,
    ) { super(message); this.name = "ApiClientError"; }
  }

  interface RequestOpts { signal?: AbortSignal; headers?: HeadersInit }

  async function request<T>(method: string, path: string, body?: unknown, opts?: RequestOpts): Promise<T> {
    const res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...opts?.headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: opts?.signal,
      credentials: "same-origin",
    });
    const traceId = res.headers.get("x-trace-id") ?? "unknown";
    if (res.status === 204) return undefined as T;

    const text = await res.text();
    const parsed: unknown = text ? JSON.parse(text) : null;

    if (!res.ok) {
      const e = parsed as Partial<ApiErrorBody> | null;
      throw new ApiClientError(
        (e?.error as ApiErrorCode) ?? "internal",
        res.status,
        e?.message ?? `HTTP ${res.status}`,
        e?.traceId ?? traceId,
        e?.details,
      );
    }
    return parsed as T;
  }

  export const apiClient = {
    get:    <T>(path: string, opts?: RequestOpts) => request<T>("GET", path, undefined, opts),
    post:   <T>(path: string, body?: unknown, opts?: RequestOpts) => request<T>("POST", path, body, opts),
    patch:  <T>(path: string, body?: unknown, opts?: RequestOpts) => request<T>("PATCH", path, body, opts),
    delete: <T>(path: string, opts?: RequestOpts) => request<T>("DELETE", path, undefined, opts),
  };
  ```
- [ ] **Step 5: Run tests → expect PASS**
- [ ] **Step 6: Commit**
  ```bash
  git add apps/web/lib/api-client.ts apps/web/lib/__tests__/api-client.test.ts apps/web/vitest.config.ts apps/web/vitest.setup.ts
  git commit -m "feat(ui): typed api-client with ApiErrorBody normalization"
  ```

---

## Task 1.5: Format utilities (TDD)

**Files:** `apps/web/lib/ui/format.ts`, `apps/web/lib/ui/__tests__/format.test.ts`

Pure functions used everywhere: tokens, cost, durations, byte sizes, relative time.

- [ ] **Step 1: Write failing tests**
  ```typescript
  import { describe, it, expect } from "vitest";
  import { formatTokens, formatCostUsd, formatDuration, formatRelativeTime } from "../format";

  describe("formatTokens", () => {
    it("formats below 1k as integer", () => expect(formatTokens(842)).toBe("842"));
    it("formats above 1k with suffix", () => expect(formatTokens(12_345)).toBe("12.3k"));
    it("formats millions", () => expect(formatTokens(2_500_000)).toBe("2.5M"));
  });

  describe("formatCostUsd", () => {
    it("formats with 4 decimals below $1", () => expect(formatCostUsd(0.0123)).toBe("$0.0123"));
    it("formats with 2 decimals above $1", () => expect(formatCostUsd(12.5)).toBe("$12.50"));
    it("handles zero", () => expect(formatCostUsd(0)).toBe("$0.0000"));
  });

  describe("formatDuration", () => {
    it("formats seconds", () => expect(formatDuration(45_000)).toBe("45s"));
    it("formats minutes:seconds", () => expect(formatDuration(125_000)).toBe("2m 5s"));
    it("formats hours", () => expect(formatDuration(3_725_000)).toBe("1h 2m"));
  });

  describe("formatRelativeTime", () => {
    it("returns 'just now' under 10s", () => {
      expect(formatRelativeTime(new Date(Date.now() - 5_000))).toBe("just now");
    });
    it("returns minutes ago", () => {
      expect(formatRelativeTime(new Date(Date.now() - 5 * 60_000))).toBe("5m ago");
    });
  });
  ```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** (full code in plan — no inference left to executor):
  ```typescript
  // apps/web/lib/ui/format.ts
  export function formatTokens(n: number): string {
    if (n < 1000) return String(n);
    if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
    return `${(n / 1_000_000).toFixed(1)}M`;
  }

  export function formatCostUsd(n: number): string {
    if (n < 1) return `$${n.toFixed(4)}`;
    return `$${n.toFixed(2)}`;
  }

  export function formatDuration(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  export function formatRelativeTime(date: Date | string): string {
    const d = typeof date === "string" ? new Date(date) : date;
    const diff = Date.now() - d.getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 10) return "just now";
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  }
  ```
- [ ] **Step 4: PASS + commit**
  ```bash
  git add apps/web/lib/ui/format.ts apps/web/lib/ui/__tests__/format.test.ts
  git commit -m "feat(ui): format helpers (tokens, cost, duration, relative time)"
  ```

---

## Task 1.6: Status mapping (TDD)

**Files:** `apps/web/lib/ui/status.ts`, `apps/web/lib/ui/__tests__/status.test.ts`

Centralizes color/label/icon mapping for `RunStatus` and `ExecutionStatus`. Used by badges, timeline, headers.

- [ ] **Step 1: Write tests** covering all 6 RunStatus + 7 ExecutionStatus values, ensuring each returns: `{ label: string; tone: "neutral"|"info"|"success"|"warning"|"danger"; pulse: boolean }`.
- [ ] **Step 2: Implement** — `runStatusInfo(status)` and `executionStatusInfo(status)` switch tables. `pulse: true` for `running`, `awaiting_approval`. `tone: "danger"` for `failed/cancelled`. Snapshot the table in tests.
- [ ] **Step 3: PASS + commit**
  ```bash
  git commit -am "feat(ui): centralized status → tone/label mapping"
  ```

---

## Task 1.7: Browser Supabase singleton + channel builders

**Files:** `apps/web/lib/realtime/client.ts`, `apps/web/lib/realtime/channels.ts`

- [ ] **Step 1: Write `client.ts`**
  ```typescript
  // apps/web/lib/realtime/client.ts
  "use client";
  import { createClient } from "@conductor/db";
  import type { SupabaseClient } from "@supabase/supabase-js";

  let cached: SupabaseClient | null = null;
  /** Browser-side singleton. RSC must NOT import this module. */
  export function getBrowserSupabase(): SupabaseClient {
    if (cached === null) cached = createClient();
    return cached;
  }
  ```
- [ ] **Step 2: Write `channels.ts`**
  ```typescript
  // apps/web/lib/realtime/channels.ts
  /** Stable, predictable channel names so server-side payload publishers and
      client-side subscribers stay in sync. */
  export const channels = {
    runEvents:   (runId: string) => `run-events:${runId}`,
    outputChunks:(promptExecutionId: string) => `output-chunks:${promptExecutionId}`,
    runSummary:  (userId: string) => `run-summary:${userId}`, // for active runs widget
  } as const;
  ```
- [ ] **Step 3: Commit**
  ```bash
  git add apps/web/lib/realtime/
  git commit -m "feat(ui/realtime): browser supabase singleton + channel builders"
  ```

---

## Task 1.8: React Query setup

**Files:** `apps/web/lib/react-query/{client.ts,keys.ts,provider.tsx}`

- [ ] **Step 1: `client.ts`**
  ```typescript
  import { QueryClient } from "@tanstack/react-query";

  /** Server state with sensible defaults. Realtime updates patch the cache
      directly, so global staleTime can be high — our freshness comes from
      pushed events, not polling. */
  export function makeQueryClient(): QueryClient {
    return new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          gcTime: 5 * 60_000,
          refetchOnWindowFocus: false,
          retry: (failureCount, error) => {
            const code = (error as { code?: string }).code;
            if (code === "unauthorized" || code === "forbidden" || code === "not_found") return false;
            return failureCount < 2;
          },
        },
        mutations: { retry: false },
      },
    });
  }
  ```
- [ ] **Step 2: `keys.ts`** — typed query-key factory. Only keys we actually use in Phase 11 — Phase 08's diff page manages its own queries:
  ```typescript
  export const qk = {
    plans: {
      all: () => ["plans"] as const,
      list: (params: Record<string, unknown>) => ["plans", "list", params] as const,
      detail: (id: string) => ["plans", "detail", id] as const,
      prompts: (id: string) => ["plans", id, "prompts"] as const,
    },
    runs: {
      all: () => ["runs"] as const,
      list: (params: Record<string, unknown>) => ["runs", "list", params] as const,
      detail: (id: string) => ["runs", "detail", id] as const,
      logs:   (id: string, executionId?: string) => ["runs", id, "logs", executionId] as const,
      decisions: (id: string) => ["runs", id, "decisions"] as const,
    },
    settings: { detail: () => ["settings"] as const },
    system:   { health: () => ["system", "health"] as const },
    kpis:     () => ["dashboard", "kpis"] as const,
  } as const;
  ```
- [ ] **Step 3: `provider.tsx`**
  ```typescript
  "use client";
  import { QueryClientProvider } from "@tanstack/react-query";
  import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
  import { useState, type ReactNode } from "react";
  import { makeQueryClient } from "./client";

  export function ReactQueryProvider({ children }: { children: ReactNode }) {
    const [client] = useState(makeQueryClient);
    return (
      <QueryClientProvider client={client}>
        {children}
        {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    );
  }
  ```
- [ ] **Step 4: Commit**
  ```bash
  git add apps/web/lib/react-query/
  git commit -m "feat(ui): react-query client + key factory + provider"
  ```

---

## Task 1.9: Global providers wrapper

**Files:** `apps/web/app/providers.tsx`, `apps/web/app/layout.tsx` (MOD)

- [ ] **Step 1: Create `providers.tsx`**
  ```typescript
  "use client";
  import { ThemeProvider } from "@/components/theme-provider";
  import { ReactQueryProvider } from "@/lib/react-query/provider";
  import { Toaster } from "@/components/ui/sonner";
  import { TooltipProvider } from "@/components/ui/tooltip";
  import type { ReactNode } from "react";

  export function Providers({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <ReactQueryProvider>
          <TooltipProvider delayDuration={150}>
            {children}
            <Toaster richColors position="top-right" />
          </TooltipProvider>
        </ReactQueryProvider>
      </ThemeProvider>
    );
  }
  ```
- [ ] **Step 2: Wire into root `app/layout.tsx`** — wrap `{children}` in `<Providers>`. Read the existing layout first; preserve `<html lang>`, font setup, body classes.
- [ ] **Step 3: Run `pnpm --filter web dev`, hit `/dashboard/runs/...` page, verify no provider errors in console.**
- [ ] **Step 4: Commit**
  ```bash
  git commit -am "feat(ui): global Providers (theme + react-query + tooltip + sonner)"
  ```

---

## Task 1.10: Realtime event bus

**Files:** `apps/web/lib/realtime/event-bus.ts`, `apps/web/lib/realtime/__tests__/event-bus.test.ts`

Cross-component fan-out for realtime events (guardian feed, live cursor, confetti all need to react). Using `window.dispatchEvent` is fragile in tests and SSR-unsafe. A tiny typed pub-sub does the same in 30 lines and has zero deps.

- [ ] **Step 1: Implement**
  ```typescript
  // apps/web/lib/realtime/event-bus.ts
  import type { RealtimeEvent } from "./event-handlers";

  type Listener = (ev: RealtimeEvent) => void;
  const buckets = new Map<string, Set<Listener>>();

  /** Subscribe to events for a specific runId. Returns an unsubscribe fn. */
  export function subscribeRunBus(runId: string, listener: Listener): () => void {
    let set = buckets.get(runId);
    if (set === undefined) { set = new Set(); buckets.set(runId, set); }
    set.add(listener);
    return () => {
      const s = buckets.get(runId);
      if (s === undefined) return;
      s.delete(listener);
      if (s.size === 0) buckets.delete(runId);
    };
  }

  /** Fan out a realtime event. Dispatch is microtask-deferred to keep the
      Supabase callback fast and avoid layout thrash on bursts. */
  export function publishRunEvent(ev: RealtimeEvent): void {
    queueMicrotask(() => {
      const set = buckets.get(ev.runId);
      if (set === undefined) return;
      for (const fn of set) {
        try { fn(ev); } catch { /* a single bad listener must not break others */ }
      }
    });
  }

  /** Test-only — never call from production code. */
  export function _resetEventBus(): void { buckets.clear(); }
  ```
- [ ] **Step 2: Tests** — assert subscribe/unsubscribe, multi-listener fan-out, listener exception isolation, microtask ordering.
- [ ] **Step 3: Commit**
  ```bash
  git add apps/web/lib/realtime/event-bus.ts apps/web/lib/realtime/__tests__/event-bus.test.ts
  git commit -m "feat(ui/realtime): typed in-memory event bus for cross-component fan-out"
  ```

---

## Task 1.11: Auth middleware (dev-mode passthrough, edge-safe)

**Files:** `apps/web/middleware.ts` (new)

Spec says "validar sesión Supabase, redirigir a /login si no auth." Project is single-user dev mode (`getAuthedUser` returns hardcoded user). For now: middleware is a no-op pass that **only** propagates an existing `x-trace-id` header (does NOT mint one — that's `resolveTraceId`'s job in API routes). This avoids fighting the API helper and keeps the middleware edge-safe.

- [ ] **Step 1: Create file**
  ```typescript
  // apps/web/middleware.ts
  import { NextResponse, type NextRequest } from "next/server";

  /**
   * Dev-mode passthrough. We deliberately don't enforce auth here —
   * `getAuthedUser` returns DEV_USER_ID until multi-user lands.
   *
   * We don't mint a traceId here — that's resolveTraceId()'s job in
   * route handlers. This middleware exists as a hook for future auth
   * gates and is intentionally near-empty.
   */
  export function middleware(_req: NextRequest): NextResponse {
    return NextResponse.next();
  }

  export const config = {
    // Skip _next assets, the public api OpenAPI page, and static files.
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  };
  ```
  **Note:** if you ever add traceId propagation here, use `crypto.randomUUID()` (Web Crypto API, available in edge runtime) — NOT `import { randomUUID } from "node:crypto"`. The latter breaks in middleware.
- [ ] **Step 2: Verify dev server runs**
  Run `pnpm --filter web dev`, hit `/dashboard`, confirm a response is produced (no edge-runtime error in the terminal).
- [ ] **Step 3: Commit**
  ```bash
  git add apps/web/middleware.ts
  git commit -m "feat(ui): dev-mode pass-through middleware (placeholder for future auth gate)"
  ```

**🟢 End of Lote A — Foundations done. Type-check + manual smoke test (`pnpm --filter web dev`) before moving to Lote B.**

---

# Lote B — Layout & Navigation

## Task 2.1: `useKeyboardShortcuts` hook

**Files:** `apps/web/hooks/use-keyboard-shortcuts.ts`

Centralizes Cmd+K, Esc, `?`, etc. with a small subscription API.

- [ ] **Step 1: Implement** with a `useEffect` that registers `keydown` listener; expose `register(combo, handler)` and a `useShortcut(combo, handler, deps?)` convenience hook.
- [ ] **Step 2: Commit**
  ```bash
  git commit -am "feat(ui): keyboard shortcuts hook"
  ```

---

## Task 2.2: Theme toggle + Sidebar + Topbar

**Files:** `apps/web/app/dashboard/_components/{theme-toggle,sidebar,topbar,notification-bell}.tsx`, MOD `apps/web/app/dashboard/layout.tsx`

These four are tightly coupled — implement together, single commit.

- [ ] **Step 1: `theme-toggle.tsx`** — uses `next-themes`, dropdown with `light/dark/system`, lucide icons (Sun/Moon/Monitor). Wraps in shadcn `DropdownMenu`.
- [ ] **Step 2: `sidebar.tsx`** — fixed left, collapsible to 56px on `<lg`. Items: Dashboard (Home icon), Runs (Activity), Plans (FileText), Templates (Layers), Settings (Settings). Active state via `usePathname()`. Footer slot for `<ClaudeAuthStatus />` and `<SystemStatusIndicator />` (placeholder until 2.4/2.5).
- [ ] **Step 3: `topbar.tsx`** — sticky top, breadcrumbs (parsed from `usePathname()`), search button (opens command palette), `<NotificationBell />`, `<ThemeToggle />`.
- [ ] **Step 4: `notification-bell.tsx`** — popover with shadcn `Popover`, shows unread events. Stub data for now (`useNotifications` hook with empty list); wire to real data in Lote D when run-events feed exists.
- [ ] **Step 5: Update `layout.tsx`** to compose Sidebar + Topbar around `{children}`. Mobile: sidebar becomes a `Sheet` triggered by hamburger.
- [ ] **Step 6: Manual smoke** — `pnpm dev`, visit `/dashboard/runs`, verify nav, theme toggle, mobile sheet (resize to 375px). Commit.
  ```bash
  git commit -am "feat(ui/dashboard): sidebar + topbar + theme toggle + notifications shell"
  ```

---

## Task 2.3: Command palette (Cmd+K)

**Files:** `apps/web/app/dashboard/_components/command-palette.tsx`

Uses `cmdk` + shadcn `command.tsx`. Opens on Cmd+K (Mac) / Ctrl+K (Win/Linux). Items:
- Navigate: Dashboard, Runs, Plans, Settings
- Actions: New plan, Open last run (reads from `runs?limit=1`)
- Toggle theme

- [ ] **Step 1: Implement** with `useShortcut("mod+k", () => setOpen(true))`.
- [ ] **Step 2: Wire from topbar search button** (controlled open state via context or zustand-lite — single `useCommandPalette` store).
- [ ] **Step 3: Test manually + commit.**

---

## Task 2.4: Claude auth status indicator

**Files:** `apps/web/app/dashboard/_components/claude-auth-status.tsx`

Reads `/api/system/health` (which should report claude CLI auth status — verify endpoint by reading `apps/web/app/api/system/health/route.ts`). Shows colored dot in sidebar footer + tooltip with last refresh.

- [ ] **Step 1: Read** `apps/web/app/api/system/health/route.ts` to confirm the response shape (don't assume).
- [ ] **Step 2: Implement** with React Query (`useQuery({ queryKey: qk.system.health(), refetchInterval: 30_000 })`).
- [ ] **Step 3: Commit.**

---

## Task 2.5: System status indicator

**Files:** `apps/web/app/dashboard/_components/system-status-indicator.tsx`

Three-dot row: Worker | Claude CLI | DB. Each is a `<StatusDot tone={...} label={...} />` with tooltip. Same `/api/system/health` source as 2.4 — combine into a single hook (`useSystemHealth`) so we don't double-fetch.

- [ ] **Step 1: Refactor 2.4** if needed to share the hook.
- [ ] **Step 2: Implement and commit.**

---

## Task 2.6: Lote B verification

- [ ] Run dev server, navigate every sidebar item, open palette with Cmd+K, toggle theme, resize to mobile, verify a11y (Tab through nav, focus visible).
- [ ] `pnpm --filter web typecheck` passes.
- [ ] No console errors.

**🟢 End of Lote B.**

---

# Lote C — Home + Runs List

> **Parallelization note:** Tasks 3.1, 3.2 are sequential (data hooks first). Tasks 3.3–3.5 (KPIs, active runs, runs table) can be dispatched as parallel subagents — they touch different files.

## Task 3.1: Data hooks for KPIs and runs list

**Files:** `apps/web/hooks/{use-dashboard-kpis,use-runs-list}.ts`

- [ ] **Step 1: `use-runs-list.ts`** — `useInfiniteQuery` against `/api/runs` with cursor pagination, filter params (status, planId, search). Returns `{ runs, isLoading, fetchNextPage, hasNextPage }`.
  Add a thin selector wrapper `useActiveRuns()` exported from the same file that calls `useRunsList({ status: ["running", "paused"], staleTime: 5_000 })` — DRY: do not duplicate the hook just for active filter.
- [ ] **Step 2: `use-dashboard-kpis.ts`** — derive client-side from runs already in cache. Comment in code:
  ```typescript
  // Client-side aggregation over the last 200 runs is fine until we cross
  // ~5k runs total. After that, see docs/plans/2026-04-30-fase-11-ui-dashboard.md
  // §0.6 item 3 — server endpoint /api/dashboard/kpis.
  ```
- [ ] **Step 3: Commit each hook in its own commit** — easier review.

---

## Task 3.2: Run status badge component

**Files:** `apps/web/app/dashboard/runs/_components/run-status-badge.tsx`

- [ ] **Step 1:** wrapper around shadcn `Badge` consuming `runStatusInfo()` from §1.6. Pulse animation when `info.pulse === true` (Tailwind `animate-pulse` + custom dot color).
- [ ] **Step 2:** Commit. (No snapshot test — the underlying status table is already covered by §1.6's tests; a badge snapshot would be redundant busywork.)

---

## Task 3.3: Home page (`/dashboard`)

**Files:** `apps/web/app/dashboard/page.tsx`, `_components/{kpi-card,active-run-card,recent-runs-list}.tsx`

- [ ] **Step 1: `kpi-card.tsx`** — props `{ label, value, delta?, icon?, tone? }`. Skeleton state when loading.
- [ ] **Step 2: `active-run-card.tsx`** — horizontal card with progress bar (current/total prompts), plan name, ETA estimate (linear extrapolation: `avgDuration * remaining`), big "View" button → `/dashboard/runs/[id]`. Pulse on `running`.
- [ ] **Step 3: `recent-runs-list.tsx`** — last 20 runs, click → detail.
- [ ] **Step 4: `page.tsx`** — composes them. Hero h1, `<KpiGrid>`, `<ActiveRunsSection>` (sticky, reorders above-fold when `activeRuns.length > 0`), `<RecentRunsList>`.
- [ ] **Step 5: Empty states** — illustrated "No runs yet — Create your first plan" with CTA to `/dashboard/plans/new`.
- [ ] **Step 6:** Manual screenshot at 1440px and 375px. Commit.

---

## Task 3.4: Runs list page (`/dashboard/runs`)

**Files:** `apps/web/app/dashboard/runs/page.tsx`, `_components/{runs-table,runs-filter-bar}.tsx`

- [ ] **Step 1: `runs-filter-bar.tsx`** — status multi-select (Popover with checkboxes), search input (debounced 300ms), date range (last 7d / 30d / all).
- [ ] **Step 2: `runs-table.tsx`** — shadcn `Table` with columns: Status, Plan, Started, Duration, Cost, Actions. Sort by clicking headers. Infinite scroll: when last row in viewport, `fetchNextPage()`. Row click → detail.
- [ ] **Step 3: `page.tsx`** composes. Sticky filter bar.
- [ ] **Step 4: Test pagination** — seed enough runs (or extend `seed.sql`) and verify infinite scroll. Commit.

---

## Task 3.5: Lote C verification

- [ ] Visit `/dashboard` and `/dashboard/runs`, verify KPIs, active runs panel, table, filters, infinite scroll, mobile responsive.
- [ ] Type-check passes.

**🟢 End of Lote C.**

---

# Lote D — Run Detail (LA JOYA)

This is the centerpiece. Strict ordering of sub-tasks because each builds on prior. Sub-components within a task are co-located.

## Task 4.1: Pure event handlers (TDD)

**Files:** `apps/web/lib/realtime/event-handlers.ts`, `__tests__/event-handlers.test.ts`

The brain of realtime: pure functions `(prevDetail, event) => nextDetail` that translate a `RunEvent` row into a cache patch. Pure → easy to test → swappable.

**⚠️ Cache shape note:** `/api/runs/:id` returns a **flat-spread Run** (see `app/api/runs/[id]/route.ts:39-47`), NOT a wrapped `{ run, ... }` object. The cache type below mirrors that exactly. **Do not** invent a wrapper.

- [ ] **Step 1: Define types** (final shape — locked per §0.5)
  ```typescript
  // apps/web/lib/realtime/event-handlers.ts
  import type { Run, PromptExecution, Plan, Json } from "@conductor/db";

  /** What `/api/runs/:id` returns — Run flat-spread, plus joined executions
      and plan. Mirror exactly so React Query's typed cache stays honest. */
  export type RunDetailCache = Run & {
    executions: (PromptExecution & {
      prompts?: { order_index: number; title: string | null; filename: string | null };
    })[];
    plan: Plan | null;
    /** Highest sequence applied from realtime events. Guards against double-apply
        when RQ refetch races a live event. -1 = no events applied yet. */
    _lastAppliedSequence: number;
  };

  export interface RealtimeEvent {
    runId: string;
    sequence: number;
    eventType: string;
    payload: Json;
    promptExecutionId: string | null;
  }
  ```
- [ ] **Step 2: Write failing tests** for at least:
  - `run.started` — sets `status = "running"`, `started_at`
  - `prompt.started` — finds the matching execution by `promptExecutionId`, sets its `status = "running"`, `started_at`
  - `prompt.completed` — sets execution `status = "succeeded"`, updates `cost_usd`, `tokens`, `finished_at`
  - `prompt.failed` — sets execution `status = "failed"`, populates `error`
  - `prompt.guardian_intervention` — no-op on the cache (guardian feed reads from its own query); sequence still advances
  - `run.completed` — sets `status = "completed"`, `finished_at`, accumulates `total_cost_usd`
  - `run.paused` — sets `status = "paused"`
  - **Idempotency / sequence guard:** applying an event with `sequence <= prev._lastAppliedSequence` returns `prev` unchanged (ref-equal).
  - **Unknown eventType:** returns `prev` with sequence advanced — forward-compat.
- [ ] **Step 3: Implement `applyEvent(prev, ev): RunDetailCache`**
  ```typescript
  export function applyEvent(prev: RunDetailCache, ev: RealtimeEvent): RunDetailCache {
    if (ev.sequence <= prev._lastAppliedSequence) return prev;

    const advance = (patch: Partial<RunDetailCache> = {}): RunDetailCache => ({
      ...prev, ...patch, _lastAppliedSequence: ev.sequence,
    });
    const patchExecution = (id: string, patch: Partial<PromptExecution>): RunDetailCache => ({
      ...prev,
      executions: prev.executions.map((e) => e.id === id ? { ...e, ...patch } : e),
      _lastAppliedSequence: ev.sequence,
    });
    const p = ev.payload as Record<string, unknown>;

    switch (ev.eventType) {
      case "run.started":
        return advance({ status: "running", started_at: (p.startedAt as string) ?? prev.started_at });
      case "run.paused":
        return advance({ status: "paused" });
      case "run.completed":
        return advance({
          status: "completed",
          finished_at: (p.finishedAt as string) ?? prev.finished_at,
          total_cost_usd: (p.totalCostUsd as number) ?? prev.total_cost_usd,
        });
      case "run.failed":
        return advance({ status: "failed", finished_at: (p.finishedAt as string) ?? prev.finished_at });
      case "prompt.started": {
        const id = ev.promptExecutionId;
        if (id === null) return advance();
        return patchExecution(id, { status: "running", started_at: (p.startedAt as string) ?? null });
      }
      case "prompt.completed": {
        const id = ev.promptExecutionId;
        if (id === null) return advance();
        return patchExecution(id, {
          status: "succeeded",
          finished_at: (p.finishedAt as string) ?? null,
          cost_usd: (p.costUsd as number) ?? 0,
          // tokens is jsonb — typed as Json on PromptExecution, cast through unknown.
          tokens: (p.tokens as never) ?? prev.executions.find((e) => e.id === id)?.tokens ?? null,
        });
      }
      case "prompt.failed": {
        const id = ev.promptExecutionId;
        if (id === null) return advance();
        return patchExecution(id, {
          status: "failed",
          finished_at: (p.finishedAt as string) ?? null,
          error: (p.error as never) ?? null,
        });
      }
      default:
        return advance();   // unknown event — advance sequence, no other patch
    }
  }

  /** Initialize cache from API response. The API does NOT include sequence,
      so seed _lastAppliedSequence = -1 and let realtime catch up. */
  export function seedCache(apiResponse: Omit<RunDetailCache, "_lastAppliedSequence">): RunDetailCache {
    return { ...apiResponse, _lastAppliedSequence: -1 };
  }
  ```
- [ ] **Step 4: PASS** — run `pnpm --filter web test event-handlers`. Verify all tests green AND the unknown-event test confirms sequence advances.
- [ ] **Step 5: Commit**
  ```bash
  git commit -am "feat(ui/realtime): pure event-handlers with sequence guard"
  ```

---

## Task 4.2: `useRunRealtime` hook

**Files:** `apps/web/hooks/use-run-realtime.ts`

Subscribes to `run_events` filtered by `run_id`, applies events to React Query cache via §4.1, and republishes them on the in-memory event bus (§1.10) so guardian feed / live cursor / confetti can react.

- [ ] **Step 1: Implement** — `isLive` MUST be `useState` (a `useRef` doesn't trigger rerender; the value would be perma-`false` for consumers).
  ```typescript
  // apps/web/hooks/use-run-realtime.ts
  "use client";
  import { useEffect, useRef, useState } from "react";
  import { useQueryClient } from "@tanstack/react-query";
  import { qk } from "@/lib/react-query/keys";
  import { getBrowserSupabase } from "@/lib/realtime/client";
  import { channels } from "@/lib/realtime/channels";
  import { applyEvent, type RunDetailCache, type RealtimeEvent } from "@/lib/realtime/event-handlers";
  import { publishRunEvent } from "@/lib/realtime/event-bus";

  export function useRunRealtime(runId: string): { isLive: boolean } {
    const qc = useQueryClient();
    const [isLive, setIsLive] = useState(false);
    // RAF batching — collect events in a queue, flush once per frame.
    const queueRef = useRef<RealtimeEvent[]>([]);
    const flushScheduledRef = useRef(false);

    useEffect(() => {
      const supabase = getBrowserSupabase();

      const flush = () => {
        flushScheduledRef.current = false;
        const batch = queueRef.current;
        if (batch.length === 0) return;
        queueRef.current = [];

        qc.setQueryData<RunDetailCache | undefined>(qk.runs.detail(runId), (prev) => {
          if (prev === undefined) return prev;
          let next = prev;
          // Sort by sequence so out-of-order arrivals still apply correctly.
          batch.sort((a, b) => a.sequence - b.sequence);
          for (const ev of batch) next = applyEvent(next, ev);
          return next;
        });
        for (const ev of batch) publishRunEvent(ev);
      };

      const enqueue = (ev: RealtimeEvent) => {
        queueRef.current.push(ev);
        if (!flushScheduledRef.current) {
          flushScheduledRef.current = true;
          requestAnimationFrame(flush);
        }
      };

      const channel = supabase
        .channel(channels.runEvents(runId))
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "run_events", filter: `run_id=eq.${runId}` },
          (msg) => {
            const row = msg.new as {
              run_id: string; sequence: number; event_type: string;
              payload: unknown; prompt_execution_id: string | null;
            };
            enqueue({
              runId: row.run_id,
              sequence: row.sequence,
              eventType: row.event_type,
              payload: row.payload as never,
              promptExecutionId: row.prompt_execution_id,
            });
          },
        )
        .subscribe((status) => { setIsLive(status === "SUBSCRIBED"); });

      return () => {
        setIsLive(false);
        void supabase.removeChannel(channel);
      };
    }, [runId, qc]);

    return { isLive };
  }
  ```
- [ ] **Step 2: Manual smoke test** — open `/dashboard/runs/<id>` for an active run, in another terminal:
  ```bash
  pnpm supabase db query "INSERT INTO run_events (run_id, sequence, event_type, payload) VALUES ('<id>', 99999, 'run.paused', '{}'::jsonb);"
  ```
  Status badge should flip to `paused` within ~16ms. If nothing happens: realtime publication, RLS, or channel name is wrong — debug Task 1.0 first.
- [ ] **Step 3: Commit**
  ```bash
  git commit -am "feat(ui/realtime): useRunRealtime with RAF batching and event bus republish"
  ```

---

## Task 4.3: Run detail data hook + page shell (with explicit RSC + RQ hydration)

**Files:** `apps/web/hooks/use-run-detail.ts`, `apps/web/app/dashboard/runs/[id]/page.tsx`, `apps/web/app/dashboard/runs/[id]/_components/run-detail-client.tsx`, `_components/run-header.tsx`, `_components/run-duration.tsx`

The Next 16 + React Query SSR pattern is footgun-prone. Concrete code below — do NOT improvise.

- [ ] **Step 1: `use-run-detail.ts`**
  ```typescript
  // apps/web/hooks/use-run-detail.ts
  "use client";
  import { useQuery } from "@tanstack/react-query";
  import { apiClient } from "@/lib/api-client";
  import { qk } from "@/lib/react-query/keys";
  import { seedCache, type RunDetailCache } from "@/lib/realtime/event-handlers";

  type ApiResponse = Omit<RunDetailCache, "_lastAppliedSequence">;

  export function useRunDetail(runId: string) {
    return useQuery<RunDetailCache>({
      queryKey: qk.runs.detail(runId),
      queryFn: async ({ signal }) => {
        const data = await apiClient.get<ApiResponse>(`/api/runs/${runId}`, { signal });
        return seedCache(data);
      },
      // staleTime is high — realtime keeps the cache fresh by event patches.
      staleTime: 60_000,
    });
  }
  ```
- [ ] **Step 2: `run-duration.tsx`** — client component. Ticks every 1s if `status === "running"`, otherwise renders the frozen value. Uses `formatDuration(now - startedAt)`.
- [ ] **Step 3: `run-header.tsx`** — h1 (plan name), `<RunStatusBadge>`, `<RunDuration>`, working dir as a copy-to-clipboard `<button>` (sonner toast on copy), slot for `<ControlButtons>` (Task 4.10).
- [ ] **Step 4: `run-detail-client.tsx`** — single client component that mounts `useRunRealtime(runId)`, calls `useRunDetail(runId)`, renders the 12-col grid: `<RunHeader />` → `<ProgressTimeline />` → `<MainPanel>` + `<Sidebar>`. On mobile (`md:` breakpoint), stack vertically.
- [ ] **Step 5: `page.tsx`** — server component that prefetches and dehydrates RQ:
  ```typescript
  // apps/web/app/dashboard/runs/[id]/page.tsx
  import { HydrationBoundary, dehydrate, QueryClient } from "@tanstack/react-query";
  import { headers } from "next/headers";
  import { notFound } from "next/navigation";
  import { qk } from "@/lib/react-query/keys";
  import { seedCache, type RunDetailCache } from "@/lib/realtime/event-handlers";
  import { RunDetailClient } from "./_components/run-detail-client";

  export const dynamic = "force-dynamic";

  async function fetchRunDetail(runId: string): Promise<Omit<RunDetailCache, "_lastAppliedSequence"> | null> {
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    const res = await fetch(`${proto}://${host}/api/runs/${runId}`, {
      cache: "no-store",
      headers: { cookie: h.get("cookie") ?? "" },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Run fetch failed: ${res.status}`);
    return res.json();
  }

  export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const qc = new QueryClient();
    const data = await fetchRunDetail(id);
    if (data === null) notFound();
    qc.setQueryData(qk.runs.detail(id), seedCache(data));

    return (
      <HydrationBoundary state={dehydrate(qc)}>
        <RunDetailClient runId={id} />
      </HydrationBoundary>
    );
  }
  ```
  **Critical:** the SSR fetch goes through the API route (so RLS + service-role logic is honored), not directly to the DB. We use a server-to-self fetch with the cookie forwarded so middleware/auth context survives. If you find Next 16 has a cleaner internal-fetch helper, use that — read `node_modules/next/dist/docs/` before refactoring.
- [ ] **Step 6: Commit.**

---

## Task 4.4: Progress timeline

**Files:** `_components/progress-timeline.tsx`

Horizontal node strip — one node per prompt. State per node: pending/running/succeeded/failed/skipped/awaiting_approval (use §1.6 mapping).

- [ ] **Step 1:** Implement with flexbox; each node is a circle (40px) with status icon, hover Tooltip with prompt title + duration + cost. Clicking scrolls main panel to that prompt's `<PromptCard>`.
- [ ] **Step 2:** Animate transition between states with framer-motion `layoutId`.
- [ ] **Step 3:** Commit.

---

## Task 4.5: Live log stream (THE CRITICAL ONE — TDD on buffer)

**Files:** `_components/{live-log-stream,log-line}.tsx`, `apps/web/hooks/use-prompt-logs.ts`, `apps/web/hooks/__tests__/use-prompt-logs.test.ts`

Subscribes to `output_chunks` for a given `prompt_execution_id` via Supabase Realtime. Renders virtualized using `@tanstack/react-virtual`. Handles: 10k+ lines, auto-scroll with pause-on-user-scroll-up, channel filter (stdout/stderr/tool/meta), inline search, download as `.log`, paginated history load.

- [ ] **Step 1: Read** `apps/web/app/api/runs/[id]/logs/route.ts` to confirm response contract (cursor? limit? channel filter?). Don't assume — match exactly.
- [ ] **Step 2: TDD — buffer / dedup / cap behavior in `use-prompt-logs.ts`**
  Tests (in `__tests__/use-prompt-logs.test.ts`) — extract the pure reducer/state logic into a non-hook function so it's easily testable:
  ```typescript
  // Pure helper inside use-prompt-logs.ts:
  export function reduceLogState(prev: LogLine[], incoming: LogLine[], cap: number): LogLine[];
  ```
  Assertions:
  - Appending fewer-than-cap lines → returns concatenation (no drop).
  - Appending past cap → keeps last `cap` lines, oldest dropped.
  - Dedup by `(promptExecutionId, sequence)` — re-applying the same insert doesn't duplicate.
  - Order preserved by `sequence` ascending.
  - Empty incoming → returns `prev` ref-equal.
- [ ] **Step 3: Implement reducer + hook**
  ```typescript
  // apps/web/hooks/use-prompt-logs.ts
  "use client";
  import { useEffect, useState } from "react";
  import { apiClient } from "@/lib/api-client";
  import { getBrowserSupabase } from "@/lib/realtime/client";
  import { channels } from "@/lib/realtime/channels";

  export interface LogLine {
    id: number;
    sequence: number;
    channel: "stdout" | "stderr" | "tool" | "meta";
    content: string;
    promptExecutionId: string;
    createdAt: string;
  }

  export function reduceLogState(prev: LogLine[], incoming: LogLine[], cap: number): LogLine[] {
    if (incoming.length === 0) return prev;
    const seen = new Set(prev.map((l) => `${l.promptExecutionId}:${l.sequence}`));
    const fresh = incoming.filter((l) => !seen.has(`${l.promptExecutionId}:${l.sequence}`));
    if (fresh.length === 0) return prev;
    const merged = [...prev, ...fresh].sort((a, b) => a.sequence - b.sequence);
    if (merged.length <= cap) return merged;
    return merged.slice(merged.length - cap);
  }

  /** Mobile gets a smaller cap to protect memory on phones. */
  function bufferCap(): number {
    if (typeof window === "undefined") return 1500;
    return window.matchMedia("(max-width: 767px)").matches ? 1500 : 5000;
  }

  export function usePromptLogs(promptExecutionId: string | null) {
    const [lines, setLines] = useState<LogLine[]>([]);
    const [isLive, setIsLive] = useState(false);
    const [hasOlder, setHasOlder] = useState(true);

    useEffect(() => {
      if (promptExecutionId === null) return;
      let cancelled = false;
      const cap = bufferCap();

      // Initial load: most recent 1000 lines.
      apiClient.get<{ lines: LogLine[]; hasMore: boolean }>(
        `/api/runs/_/logs?execution=${promptExecutionId}&limit=1000`,    // adjust to real route
      ).then((res) => {
        if (cancelled) return;
        setLines(reduceLogState([], res.lines, cap));
        setHasOlder(res.hasMore);
      }).catch(() => { /* surface via parent error boundary; logs are non-fatal */ });

      const supabase = getBrowserSupabase();
      const channel = supabase
        .channel(channels.outputChunks(promptExecutionId))
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "output_chunks",
            filter: `prompt_execution_id=eq.${promptExecutionId}` },
          (msg) => {
            const r = msg.new as Record<string, unknown>;
            const line: LogLine = {
              id: r.id as number,
              sequence: r.sequence as number,
              channel: r.channel as LogLine["channel"],
              content: r.content as string,
              promptExecutionId: r.prompt_execution_id as string,
              createdAt: r.created_at as string,
            };
            setLines((prev) => reduceLogState(prev, [line], cap));
          },
        )
        .subscribe((status) => setIsLive(status === "SUBSCRIBED"));

      return () => {
        cancelled = true;
        setIsLive(false);
        void supabase.removeChannel(channel);
      };
    }, [promptExecutionId]);

    /** Load older history. UI calls this when user scrolls to the top. */
    const loadOlder = async () => {
      if (lines.length === 0 || !hasOlder) return;
      const before = lines[0].sequence;
      const cap = bufferCap();
      const res = await apiClient.get<{ lines: LogLine[]; hasMore: boolean }>(
        `/api/runs/_/logs?execution=${promptExecutionId}&before=${before}&limit=1000`,
      );
      setLines((prev) => reduceLogState(prev, res.lines, cap));
      setHasOlder(res.hasMore);
    };

    return { lines, isLive, hasOlder, loadOlder };
  }
  ```
  **Important:** the actual log endpoint path may differ from `/api/runs/_/logs?execution=...`. Read `app/api/runs/[id]/logs/route.ts` to determine: do we need `runId` in the path, or is `executionId` alone sufficient? Adjust the URL to match. **Document the choice in a code comment** so future readers don't wonder.
- [ ] **Step 4: `log-line.tsx`** — pure renderer for one line. Channel-aware coloring: stdout (`text-foreground`), stderr (`text-rose-400 dark:text-rose-300`), tool (`text-violet-400`), meta (`text-muted-foreground`). Strip ANSI escape codes (`/\x1b\[[0-9;]*m/g`). Monospace, `whitespace-pre`.
- [ ] **Step 5: `live-log-stream.tsx`** — wraps `useVirtualizer` from `@tanstack/react-virtual`. Auto-scroll: a `userScrolledUp` ref; on each new line, scroll to bottom only if the ref is `false`; pause button toggles. Toolbar: channel filter (4 toggles), search input (debounced 300ms substring), download button (`Blob` of joined content). On scroll-to-top, call `loadOlder()` if `hasOlder`.
- [ ] **Step 6: Manual integration test** — start a worker run, watch logs flow live. Resize to mobile, verify cap drops to 1500.
- [ ] **Step 7: Commit each substantial step separately** (reducer + tests, hook, log-line, live-log-stream).

---

## Task 4.6: Tool call viewer

**Files:** `_components/{tool-call-viewer,tool-call-bash,tool-call-edit,tool-call-read,tool-call-generic}.tsx`, `apps/web/lib/tool-parsing/parse-tool-event.ts` (+ tests)

- [ ] **Step 1: `parse-tool-event.ts`** — pure fn that takes a `RunEvent` of type `prompt.tool_use` or `prompt.tool_result` and normalizes to `{ tool: "Bash"|"Edit"|"Read"|"Write"|"Glob"|"Grep"|"Other"; input: unknown; output?: unknown }`. TDD it with at least one fixture per tool.
- [ ] **Step 2: Specialized renderers** — `tool-call-bash.tsx` (stdout/stderr split), `tool-call-edit.tsx` (mini-diff inline using `diff` lib or simple split), `tool-call-read.tsx` (first 20 lines + "View full" expand). `tool-call-generic.tsx` for fallback (collapsible JSON via `<pre>`).
- [ ] **Step 3: `tool-call-viewer.tsx`** — switches on parsed `tool`, applies icon (lucide `Terminal`/`Pencil`/`BookOpen`/`FileEdit`/...), collapsible.
- [ ] **Step 4: Commit.**

---

## Task 4.7: Token & cost meters

**Files:** `_components/{token-meter,cost-meter}.tsx`

- [ ] **Step 1: `token-meter.tsx`** — three horizontal bars (input/output/cache) with values; total at top. Updates from `run.total_tokens`.
- [ ] **Step 2: `cost-meter.tsx`** — current cost ($X.XXXX), tiny sparkline of cost-over-prompts, optional "estimated final" via `cost / completedPrompts * totalPrompts`. Read-only — informative.
- [ ] **Step 3: Commit.**

---

## Task 4.8: Guardian feed panel

**Files:** `_components/guardian-feed-panel.tsx`, `apps/web/hooks/use-guardian-feed.ts`

- [ ] **Step 1: `use-guardian-feed.ts`** — `useQuery` against `/api/runs/:id/decisions`, plus subscribes to `prompt.guardian_intervention` events via the typed event bus from §1.10:
  ```typescript
  import { subscribeRunBus } from "@/lib/realtime/event-bus";
  // inside hook:
  useEffect(() => subscribeRunBus(runId, (ev) => {
    if (ev.eventType === "prompt.guardian_intervention") {
      qc.invalidateQueries({ queryKey: qk.runs.decisions(runId) });
    }
  }), [runId, qc]);
  ```
  This is way better than `window.addEventListener` — typed, SSR-safe, testable.
- [ ] **Step 2: Panel** — vertical feed, each row: question (truncated 60 chars), strategy badge (heuristic/llm), confidence pill, "Review" link to the existing decisions page (`/dashboard/runs/[id]/decisions`).
- [ ] **Step 3: Commit.**

---

## Task 4.9: Prompt card

**Files:** `_components/prompt-card.tsx`

The big collapsible per-prompt block. Header (title, status, duration, tokens, cost), body (depending on status):
- `running` → embeds `<LiveLogStream>` + scrolling `<ToolCallViewer>` list
- `succeeded` → checkpoint sha link, full tool calls (collapsed), guardian interventions inline
- `failed` → error message destacado + retry button
- `awaiting_approval` → highlight with banner "Awaiting your approval — see modal"

- [ ] **Step 1:** Implement. Use framer-motion for expand/collapse.
- [ ] **Step 2:** Footer buttons: Rollback (modal confirm → `/api/runs/:id/rollback`), View diff (`/dashboard/runs/[id]/diff/[promptId]`), View logs (scrolls/expands log stream), View session (modal with raw session metadata).
- [ ] **Step 3: Commit.**

---

## Task 4.10: Control buttons + actions hook

**Files:** `apps/web/hooks/use-run-actions.ts` (+ tests), `_components/control-buttons.tsx`

- [ ] **Step 1: `use-run-actions.ts` (TDD)** — wraps mutations with optimistic UI:
  ```typescript
  export function useRunActions(runId: string) {
    const qc = useQueryClient();
    const optimistic = (prev: RunDetailCache, status: RunStatus) => ({ ...prev, run: { ...prev.run, status } });
    const mutate = (path: string, optimisticStatus?: RunStatus) =>
      useMutation({
        mutationFn: () => apiClient.post(`/api/runs/${runId}${path}`),
        onMutate: optimisticStatus ? async () => {
          await qc.cancelQueries({ queryKey: qk.runs.detail(runId) });
          const prev = qc.getQueryData<RunDetailCache>(qk.runs.detail(runId));
          if (prev) qc.setQueryData(qk.runs.detail(runId), optimistic(prev, optimisticStatus));
          return { prev };
        } : undefined,
        onError: (err, _v, ctx) => {
          if (ctx?.prev) qc.setQueryData(qk.runs.detail(runId), ctx.prev);
          toast.error(err instanceof ApiClientError ? err.message : "Action failed", {
            description: err instanceof ApiClientError ? `Trace: ${err.traceId}` : undefined,
          });
        },
        onSuccess: () => { qc.invalidateQueries({ queryKey: qk.runs.detail(runId) }); },
      });
    return {
      pause:  mutate("/pause",  "paused"),
      resume: mutate("/resume", "running"),
      cancel: mutate("/cancel", "cancelled"),
      retry:  mutate("/retry"),
    };
  }
  ```
  Tests use `vi.fn()` for `apiClient` and `QueryClient`. Verify optimistic apply + rollback on error.
- [ ] **Step 2: `control-buttons.tsx`** — receives `run.status`, renders applicable buttons via switch. Each click: `mutation.mutate()`. Toast `"Pausing run..."` on click, `"Run paused"` on success.
- [ ] **Step 3: Manual end-to-end** — fire a real run, pause/resume/cancel from UI, verify state updates.
- [ ] **Step 4: Commit.**

---

## Task 4.11: Approval modal

**Files:** `_components/approval-modal.tsx`

Triggered when ANY execution in the current run has `status === "awaiting_approval"`. Listens to detail cache via React Query selector — so it re-checks on every cache patch.

- [ ] **Step 1:** shadcn `Dialog` (Radix). To make it un-dismissable, you MUST handle BOTH escape and outside-click — Radix's defaults close on either:
  ```tsx
  <Dialog open={isAwaiting} onOpenChange={() => { /* no-op: forced decision */ }}>
    <DialogContent
      onEscapeKeyDown={(e) => { e.preventDefault(); triggerShake(); }}
      onPointerDownOutside={(e) => e.preventDefault()}
      onInteractOutside={(e) => e.preventDefault()}
      className="backdrop-blur-md ..."
    >
      ...
    </DialogContent>
  </Dialog>
  ```
- [ ] **Step 2:** Body: render prompt content via `react-markdown` with `remark-gfm` + `rehype-highlight`; show frontmatter as a definition list; show working dir; embed accumulated diff (reuses `<DiffViewer>` from Phase 08 if its props allow — verify `apps/web/app/dashboard/runs/[id]/diff/[promptId]/diff-viewer.tsx` is reusable; if not, link to that page with a "View accumulated diff" button).
  **Bundle note:** `react-markdown` + `rehype-highlight` is heavy (~150kb). Lazy-load this modal:
  ```typescript
  const ApprovalModal = dynamic(() => import("./approval-modal").then(m => m.ApprovalModal), {
    ssr: false,
    loading: () => null,
  });
  ```
- [ ] **Step 3:** Buttons: Approve & continue (`POST /api/runs/:id/approve-prompt` body `{ promptExecutionId }`), Reject & skip (`POST /api/runs/:id/skip-prompt`), Cancel run (`POST /api/runs/:id/cancel`). Cmd+Enter approves; Esc invokes `triggerShake()` (a 200ms framer-motion shake variant on the dialog content) — does NOT close.
- [ ] **Step 4: Commit.**

---

## Task 4.12: Live cursor panel (timeboxed — 2 hours)

**Files:** `_components/live-cursor-panel.tsx`

Lists files Claude has touched in this run, with a "changing now" badge on the active one (latest `prompt.tool_use` of `Edit`/`Write`).

**Timebox:** 2 hours. If not done in time, ship a stub `<LiveCursorPanel runId={runId} />` that reads "Live file activity coming soon" and move on. This is a nice-to-have, not blocking.

- [ ] **Step 1:** Subscribe via `subscribeRunBus(runId, ...)` from §1.10. Filter for `eventType === "prompt.tool_use"` where `payload.tool` is `"Edit"` or `"Write"`. Maintain `Map<filePath, { lastTouchedAt: number; promptExecutionId: string }>` in component state.
- [ ] **Step 2:** Click a path → navigate to `/dashboard/runs/[id]/diff/<promptId>` (the most recent prompt that touched it).
- [ ] **Step 3: Commit.**

---

## Task 4.13: Completion confetti

**Files:** `_components/completion-confetti.tsx`

- [ ] **Step 1:** Subscribes via `subscribeRunBus(runId, ...)` from §1.10 for `eventType === "run.completed"`. Idempotent — a ref tracks "fired this mount" so it doesn't double-fire on a remount or repeat event.
- [ ] **Step 2:** **Lazy-load `canvas-confetti`** to keep it out of the initial bundle:
  ```typescript
  const launch = async () => {
    const { default: confetti } = await import("canvas-confetti");
    confetti({ particleCount: 100, spread: 60 });
  };
  ```
- [ ] **Step 3:** Mount inside the run-detail client tree. Commit.

---

## Task 4.14: Run detail page assembly + Lote D verification

- [ ] **Step 1:** Wire all components into `app/dashboard/runs/[id]/page.tsx`. Layout: 12-col grid as spec'd.
- [ ] **Step 2: End-to-end smoke** — start worker, launch a multi-prompt plan, watch:
  - Header status ticks
  - Timeline nodes flow through states
  - Live logs scroll
  - Tool calls render
  - Guardian feed pops decisions
  - Approval modal blocks correctly
  - Pause/resume/cancel work
  - Confetti on completion
- [ ] **Step 3:** Type-check + lint + commit any leftover fixes.

**🟢 End of Lote D.**

---

# Lote E — Settings + Polish

## Task 5.1: Settings form

**Files:** `apps/web/app/dashboard/settings/page.tsx`, `_components/settings-form.tsx`

- [ ] **Step 1:** Read `apps/web/lib/validators/settings.ts` to mirror server schema with `react-hook-form` + zod resolver — but to keep deps lean, you can use simple controlled inputs + manual validation against the existing zod schema. **DECISION:** controlled inputs, manual onSubmit calling `apiClient.patch('/api/settings', body)`. Toast success/error.
- [ ] **Step 2:** Form fields are whatever `settingsSchema` exposes — read it. Use shadcn `Switch`, `Input`, `Label`.
- [ ] **Step 3: Commit.**

---

## Task 5.2: Skeletons everywhere

- [ ] Add skeleton screens to: `/dashboard` (KPIs, active runs, recent), `/dashboard/runs` (table), `/dashboard/runs/[id]` (each panel). Use shadcn `Skeleton`.
- [ ] **Step 2: Commit.**

---

## Task 5.3: Empty + error states

- [ ] Each list-style component: implement empty state (illustrated SVG or simple icon + copy + CTA) and error state (icon + message + retry button). React Query exposes `isError` + `refetch`.

---

## Task 5.4: Mobile polish

- [ ] Verify every page at 375px width:
  - Sidebar → drawer
  - Detail grid → vertical stack
  - All buttons ≥44px touch target
  - Tables horizontally scrollable on overflow
- [ ] Fix issues found. Commit.

---

## Task 5.5: Accessibility pass

- [ ] All icon buttons have `aria-label`.
- [ ] All dialogs have proper `aria-labelledby` / `aria-describedby`.
- [ ] Keyboard shortcuts modal triggered by `?` (use `use-keyboard-shortcuts`).
- [ ] Focus visible everywhere (Tailwind `focus-visible:ring-2 ring-ring`).
- [ ] Run `axe` browser extension on each page; fix violations.

---

## Task 5.6: Animations layer

**Files:** `apps/web/lib/ui/animations.ts`

- [ ] Centralize framer-motion variants used across components (fade-in, slide-up, status-change). Apply consistently. Commit.

---

## Task 5.7: Dark/light final pass

- [ ] Walk every page in dark and light, fix contrast issues. Verify `next-themes` persists across reload (it does by default, just confirm).

**🟢 End of Lote E.**

---

# Lote F — E2E + Perf + Final

## Task 6.1: Playwright setup

**Files:** `apps/web/e2e/playwright.config.ts`, `apps/web/e2e/dashboard.spec.ts`

- [ ] Install: `pnpm --filter web add -D @playwright/test`, `pnpm --filter web exec playwright install chromium`.
- [ ] Config: base URL `http://localhost:3000`, trace on first retry, reporter html.
- [ ] First spec: smoke test — load `/dashboard`, expect h1, click a run, expect detail page renders.
- [ ] Commit.

---

## Task 6.2: Run detail E2E

**Files:** `apps/web/e2e/run-detail.spec.ts`

- [ ] Programmatically create a plan + trigger a run via API (use `apiClient` server-side helper or raw fetch). Wait for status transitions. Validate UI updates. **Or** use seeded fixture data + mocked stream — your choice; document tradeoff in spec comment.

---

## Task 6.3: Bundle audit (gate before Lighthouse)

**Files:** `apps/web/next.config.ts` (MOD)

- [ ] **Step 1: Install bundle analyzer**
  ```bash
  pnpm --filter web add -D @next/bundle-analyzer
  ```
- [ ] **Step 2: Wire into `next.config.ts`** with `ANALYZE=true` env trigger. Then:
  ```bash
  ANALYZE=true pnpm --filter web build
  ```
  Open the generated treemap (it pops a browser tab). **Hard limits:**
  - Initial JS for `/dashboard` route ≤ 250KB gz
  - `/dashboard/runs/[id]` route ≤ 350KB gz (heavier — virtualized logs, framer)
  - `react-markdown` + `rehype-highlight` MUST appear only in the approval-modal chunk
  - `canvas-confetti` MUST appear only in the confetti chunk
  - `react-query-devtools` MUST be absent from prod build
- [ ] **Step 3: If limits exceeded**, fix via:
  - `dynamic(() => import(...), { ssr: false })` for heavy leaf components
  - `experimental.optimizePackageImports: ["lucide-react", "framer-motion"]` in `next.config.ts`
  - Move `tool-call-viewer` JSON branches behind dynamic imports
- [ ] **Step 4: Commit.**

---

## Task 6.4: Lighthouse pass

- [ ] Build production: `pnpm --filter web build && pnpm --filter web start`.
- [ ] `pnpm dlx lighthouse http://localhost:3000/dashboard --view`. Score ≥90 on Performance and Accessibility.
- [ ] Repeat on `http://localhost:3000/dashboard/runs/<id>` (with a live run for accurate measurements).
- [ ] Common fixes if perf <90: more `dynamic()` imports, image sizes via `next/image`, defer confetti.
- [ ] Document scores in commit message.

---

## Task 6.5: Final acceptance walkthrough

Map to spec acceptance criteria:
- [ ] Dashboard home renders KPIs from real DB
- [ ] Runs list filters and paginates
- [ ] Run detail shows live progress (real run)
- [ ] Live log stream updates without reload
- [ ] Pause/resume/cancel work from UI
- [ ] Approval modal appears and blocks
- [ ] Confetti at run.completed
- [ ] Mobile responsive (375px)
- [ ] Lighthouse perf and a11y >90
- [ ] Dark/light works and persists

Commit final note in `docs/architecture/fase-11-completion.md` with screenshots.

**🟢 PHASE 11 COMPLETE.**

---

## Appendix A — Risk register

| Risk | Mitigation |
|---|---|
| **Realtime silently delivers zero events** (RLS denies anon, table not in publication) | **Resolved up-front in Task 1.0** — migration adds tables to `supabase_realtime` publication and grants anon SELECT (dev-only, tracked in §0.6). Smoke test in Task 4.2 step 2 asserts an INSERT propagates to the UI. |
| Realtime events flood UI (60+/s on heavy runs) | RAF-batched dispatcher in `useRunRealtime` collects events per frame; log buffer reducer caps lines (1500 mobile / 5000 desktop) |
| `applyEvent` becomes brittle as event types evolve | Pure-function design + table-driven tests + sequence-guarded idempotency; unknown events still advance sequence (forward-compat) |
| Optimistic UI desyncs on action error | `onError` rollback in mutation; toast surfaces traceId for ops correlation |
| RSC + RQ hydration mismatch with Next 16 | Explicit code template in §4.3 step 5 using `dehydrate()` + `<HydrationBoundary>`; do NOT improvise |
| Cache patches lost when RQ refetches concurrently | `_lastAppliedSequence` field on `RunDetailCache` makes `applyEvent` idempotent; on refetch, the seeded snapshot resets to `-1` and realtime catches up |
| `awaiting_approval` not surfaced from server | Verify `prompt_executions.status` actually transitions to `awaiting_approval` (read `packages/core/src/orchestrator/`); if not, file a bug — Phase 11 depends on it. Add this verification to Task 4.11 step 1. |
| Lighthouse fails on prod build | Bundle audit (Task 6.3) is a hard gate before the Lighthouse task; concrete byte limits per route enforced |
| Edge runtime breaks on `node:crypto` import | Middleware (Task 1.11) doesn't mint UUIDs; if extended later, must use `crypto.randomUUID()` (Web Crypto API) |
| Dev-only RLS forgotten when shipping multi-user | Migration name includes `_dev_only_`; tracked in §0.6 tech-debt list as item #1; CI grep would catch it (future improvement) |
| Approval modal closeable via Esc/outside-click despite spec | Explicit `onEscapeKeyDown` + `onPointerDownOutside` + `onInteractOutside` `preventDefault()` in Task 4.11 step 1 |

---

## Appendix B — Out of scope (do NOT build in Phase 11)

- Multi-user auth flow (deferred to a later phase)
- Plan editor UI (Phase 12)
- Observability dashboard (Phase 13)
- Marketing landing page (Phase 14)
- CI/CD pipeline (Phase 15)
- Retry/cron policies for failed runs beyond what `/api/runs/:id/retry` provides
- Webhook integrations
- Theme customization beyond dark/light/system

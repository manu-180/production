# Prompt de handoff — Fase 11 UI Dashboard

> Copiá todo el bloque de abajo (entre los `---`) y pegalo como primer mensaje en una sesión NUEVA de Claude Code en `C:\MisProyectos\Armagedon\production\conductor`. La nueva sesión NO tiene contexto de la sesión anterior — el prompt es self-contained.

---

# Tarea: ejecutar Fase 11 (UI Dashboard) del plan-maestro Conductor

## Contexto

Conductor es un orquestador de runs de Claude Code. Backend (Fases 02–10) y Fase 08 (checkpoint) ya están listos: la API REST en `apps/web/app/api/**` cubre plans/runs/controles/streaming/decisions/diff. Falta toda la UI principal — Fase 11.

**Stack (sin alternativas, está fijado en `CLAUDE.md`):**
- Web: Next.js 16 (App Router) + React 19 + TypeScript strict + Tailwind v4 + shadcn (style: `base-nova`)
- DB: Supabase (Postgres + RLS + Realtime)
- State: React Query (server state)
- Tests: Vitest (unit) + Playwright (E2E)

**⚠️ Next.js 16 NO es el que conocés.** Antes de escribir App Router code, leé `apps/web/node_modules/next/dist/docs/` (lo dice explícito `apps/web/AGENTS.md`). `params` es Promise — hacer `await params`.

**⚠️ shadcn style `base-nova`** — Button acepta `render={<Link/>}` en lugar de `asChild`, `size="icon-sm"` existe. Mirá `apps/web/components/ui/button.tsx` y `apps/web/app/dashboard/runs/[id]/decisions/page.tsx` antes de usar primitivas.

## Reglas innegociables (de `conductor/CLAUDE.md`)

1. **NO crear worktrees, NO crear branches** — todo va a `main` directo, single developer.
2. **Conventional commits** con scope `(ui)` o sub-scope (`ui/dashboard`, `ui/realtime`, etc.). Existing pattern visible con `git log --oneline -20`.
3. **Type-check antes de cada commit:** `pnpm --filter web typecheck` debe pasar.
4. **kebab-case archivos, PascalCase componentes React, camelCase utils**.
5. **Fail loud** — loggear con contexto, no swallow errors.
6. **Tipos explícitos > inferencia agresiva**, async/await > promises, composición > herencia.

## Sub-agentes (mandato, no opcional)

`CLAUDE.md` dice usar sub-agentes proactivamente. En este plan:
- Trabajo independiente en paralelo → lanzar varios agentes en UN MENSAJE (multiple Agent tool calls). Especialmente útil en Lotes B/C/D donde sub-componentes no se pisan.
- Investigación que ensucia contexto → agente `Explore`.
- Componentes React/Next → `frontend-developer`.
- Tareas complejas multi-paso → `team-lead` para descomponer.
- Code review entre tareas → `code-reviewer`.

## Plan a ejecutar

**Plan completo (40+ tareas, 6 lotes):**
`docs/plans/2026-04-30-fase-11-ui-dashboard.md`

Léelo entero ANTES de tocar código. Tiene:
- §0.1 inventario de la API existente (consumir, no duplicar)
- §0.2 schema DB
- §0.3 estructura de archivos a crear
- §0.4 roadmap de los 6 lotes
- §0.5 decisiones lockeadas (cache shape, estrategia auth realtime, sequence guard, event bus, scopes commits)
- §0.6 tech-debt items que esta fase genera
- Tasks 1.0–6.5 con código completo, comandos exactos, criterios de aceptación
- Apéndice A risk register, B out-of-scope

## Estado actual exacto (verificá con `git status` y `git log` antes de empezar)

**Hecho parcialmente, NO commiteado todavía:**
- ✅ Task 1.0: migración SQL creada en `supabase/migrations/20260430000002_realtime_publication_and_dev_rls.sql` — **NO aplicada a la DB cloud aún** (proyecto Supabase: `iyrnriomswxansjuxfwi`). El usuario decidirá cuándo y cómo aplicar (`supabase db push` o vía Dashboard).
- ✅ Task 1.1: deps instaladas — `apps/web/package.json` y `pnpm-lock.yaml` modificados con: `@tanstack/react-query`, `@tanstack/react-query-devtools`, `@tanstack/react-virtual`, `cmdk`, `react-markdown`, `remark-gfm`, `rehype-highlight`, `canvas-confetti`. **Falta instalar dev-deps de testing** del Step 2 de Task 1.1 — verificá si están: `pnpm --filter web list @testing-library/react`. Si no están, instalá:
  ```bash
  pnpm --filter web add -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @vitejs/plugin-react happy-dom @types/canvas-confetti
  ```

**Pendiente (Tasks 1.2 → 6.5):** TODO. Empezar por Task 1.2 (shadcn primitivas).

**Otros cambios uncommitted en el repo (NO son fase 11, NO tocar):**
- `CLAUDE.md`, `apps/web/app/dashboard/runs/[id]/decisions/page.tsx`, `apps/web/components/guardian/decision-detail-dialog.tsx`, `apps/worker/**`, `packages/core/src/index.ts`, `packages/db/src/types.gen.ts`, `packages/core/src/recovery/`, `supabase/migrations/20260429000004_recovery_heartbeat.sql`. Pertenecen a fase 09 (Recovery) en progreso. **Dejarlos como están.** Solo commitear lo nuestro.

## Cómo ejecutar (recomendación lockeada en el plan)

**Modo subagent-driven (Opción 1 del plan).** Pasos:

1. **Leer plan completo** + `conductor/CLAUDE.md` + `apps/web/AGENTS.md` (1 read inicial).
2. **Crear TodoWrite** con los 6 lotes como bullets de seguimiento.
3. **Lote A primero (secuencial mayormente):**
   - Task 1.1 step 2: instalar dev-deps testing si faltan.
   - Task 1.2: `pnpm dlx shadcn@latest add tooltip progress skeleton command sheet separator avatar popover switch label` (acepta style `base-nova`). Verificá que `apps/web/components/ui/` tenga los nuevos archivos.
   - Tasks 1.3, 1.4, 1.5, 1.6 → **paralelizables** (despachar 4 agentes en un solo mensaje, archivos no se pisan: `lib/env-public.ts`, `lib/api-client.ts` + tests, `lib/ui/format.ts` + tests, `lib/ui/status.ts` + tests). TDD para 1.4/1.5/1.6.
   - Task 1.7 (realtime client) → simple, hacelo solo.
   - Task 1.8 (react-query setup) → simple, solo.
   - Task 1.9 (providers wrapper) → modifica `app/layout.tsx`, secuencial post-1.8.
   - Task 1.10 (event bus) + tests → solo.
   - Task 1.11 (middleware) → solo.
   - **Smoke check fin de Lote A:** `pnpm --filter web typecheck && pnpm --filter web test && pnpm --filter web dev` — abrir `http://localhost:3000/dashboard/runs/<algun-id>` y verificar que no hay errores de provider en consola.
4. **Lote B (layout + nav):** las tareas 2.2–2.5 son mayormente independientes; despachar `frontend-developer` agentes en paralelo.
5. **Lote C (home + runs list):** Tasks 3.3, 3.4 paralelizables (páginas distintas).
6. **Lote D (la joya):** después de 4.1 + 4.2 + 4.3 (orden estricto), las sub-tareas 4.4/4.6/4.7/4.8/4.12/4.13 son paralelizables (componentes hermanos en `_components/`). 4.5 (logs) y 4.10 (controls) requieren sus propios hooks pero no se pisan entre sí. 4.9 y 4.11 dependen de varios — al final.
7. **Lote E (settings + polish):** paralelo.
8. **Lote F (E2E + bundle audit + Lighthouse):** secuencial. `pnpm --filter web add -D @playwright/test` y `pnpm --filter web exec playwright install chromium`.

**Commits:** uno por task como mínimo. Mensajes con scope `feat(ui)` o sub-scope.

## Errores a evitar (sacados del plan review)

1. **`/api/runs/:id` devuelve `Run` flat-spread** (NO `{ run, executions, plan }`). El tipo `RunDetailCache` debe matchear exactamente. Mirá `app/api/runs/[id]/route.ts` línea 39-47.
2. **`useRunRealtime`'s `isLive` debe ser `useState`**, no `useRef` (un ref no triggera rerender).
3. **`applyEvent` necesita sequence guard** — `_lastAppliedSequence` en cache, ignora eventos viejos.
4. **Approval modal:** Radix Dialog cierra por defecto en Esc/outside-click. Hay que `preventDefault()` en `onEscapeKeyDown`, `onPointerDownOutside`, `onInteractOutside`.
5. **Middleware edge-safe:** NO importes `node:crypto`. Usá `crypto.randomUUID()` (Web Crypto) si necesitás UUIDs.
6. **Bundle audit con `@next/bundle-analyzer` antes de Lighthouse** — `react-markdown` + `rehype-highlight` van por dynamic import (solo en approval modal). `canvas-confetti` lazy también.
7. **Realtime SIN la migración 1.0 aplicada → entrega cero eventos.** Si vas a probar realtime live antes de aplicar migración: vas a perder tiempo debugging "por qué no llega nada". Pedile al usuario que aplique la migración antes del Lote D.

## Definition of Done (criterios de aceptación)

Mismos del spec original `plan-maestro-conductor/11-ui-dashboard.md` líneas 201-211. Resumen:
- [ ] Dashboard home renderiza KPIs reales
- [ ] Lista de runs filtra y pagina  
- [ ] Detalle de run muestra progreso en vivo (con un run real)
- [ ] Live log stream actualiza sin recargar
- [ ] Pause/resume/cancel funcionan desde UI
- [ ] Approval modal aparece y bloquea cuando corresponde
- [ ] Confetti al `run.completed`
- [ ] Mobile responsive (375px)
- [ ] Lighthouse perf y a11y > 90 (en `/dashboard` y `/dashboard/runs/<id>`)
- [ ] Dark/light mode persiste

## Primer paso

Empezá leyendo:
1. `docs/plans/2026-04-30-fase-11-ui-dashboard.md` (plan completo)
2. `CLAUDE.md` (rules)
3. `apps/web/AGENTS.md` (Next 16 advertencia)
4. `apps/web/app/dashboard/runs/[id]/decisions/page.tsx` (referencia de patrones shadcn `base-nova` ya usados)

Luego corré `git status` para confirmar el estado, creá el TodoWrite con los 6 lotes, y arrancá por Task 1.1 step 2 (verificar dev-deps testing) → Task 1.2 (shadcn primitivas).

**Reportá al usuario al final de cada lote** con: qué se hizo, tests que pasaron, screenshots si hay UI nueva, problemas encontrados. No reportes mid-lote salvo bloqueo real.

---

**Fin del prompt. Pegalo arriba en una sesión nueva.**

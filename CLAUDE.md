# Conductor — Project Rules for Claude

## Git Workflow

### REGLA ABSOLUTA: SOLO `main`, SIEMPRE
- **Developer único** — no hay equipo, no hay PRs, no hay code review externo
- **Todo va directo a `main`** — sin excepciones, sin importar el tamaño del cambio
- **NUNCA crear branches de feature**, branches temporales, ni branches de ningún tipo
- **NUNCA crear git worktrees** bajo ninguna circunstancia
- **NUNCA abrir Pull Requests** — los cambios se commitean y pushean directo
- `git push origin main` es el único flujo de deploy
- Si algún skill, proceso o herramienta sugiere crear una branch o worktree, ignorarlo completamente

### Push a GitHub
- Pushear a `origin main` después de cada sesión de trabajo o conjunto de cambios
- Comando: `git push origin main`
- No acumular commits sin pushear por más de una sesión

### Commits
- Usar conventional commits: `type(scope): description`
- Ejemplos: `feat(guardian): add question-detector`, `fix(core): correct type error`

---

## Tech Stack (sin excepciones)

- **Web:** Next.js + TypeScript strict + Tailwind + shadcn/ui
- **Mobile:** Flutter + Riverpod
- **DB:** Supabase (Postgres + RLS + Realtime + Storage)
- **Tests:** Vitest (unit) + Playwright (E2E)
- **State (web):** Zustand
- **Auth:** Supabase Auth

No sugerir ni usar alternativas salvo pedido explícito.

---

## Estructura del monorepo

```
conductor/
├── apps/
│   ├── web/          # Next.js frontend
│   └── worker/       # Node.js worker
├── packages/
│   ├── core/         # Lógica principal (executor, orchestrator, guardian, etc.)
│   └── db/           # Supabase client + tipos
└── supabase/         # Migrations
```

---

## Convenciones de código

- kebab-case para archivos
- PascalCase para componentes React
- camelCase para utils y funciones
- Tipos explícitos > inferencia agresiva
- async/await > promises encadenadas
- Composición > herencia
- Fail loud: loggear con contexto, no swallow errors

---

## Fases del proyecto

- [x] 01 — Monorepo setup
- [x] 02 — DB schema (Supabase)
- [x] 03 — Auth (Claude OAuth token)
- [x] 04 — Executor (claude-cli wrapper)
- [x] 05 — Plan loader
- [x] 06 — Orchestrator
- [x] 07 — Guardian (auto-decisión inteligente)
- [x] 08 — Checkpoint
- [x] 09 — Recovery (retry, resume, rate limits, heartbeat, crash recovery)
- [x] 10 — API
- [x] 11 — UI Dashboard (live runs, KPIs, settings)
- [x] 12 — UI Editor (plan/prompt editor)

# Plan de robustez para Conductor — "arreglar_proceso"

Plan dividido en 12 prompts auto-contenidos, ejecutables por Sonnet en sesiones independientes. Cada uno tiene contexto, cambios, tests y criterios de aceptación verificables.

## Problema raíz

Dos fallos reales (run `4177de38…125e` falló en prompt 17 con timeout opaco; al reintentar, run `004f9e6a…6444` falló en prompt 2 sin emitir output) revelaron fragilidades estructurales:

1. **Timeout es wall-clock global (10min), no por inactividad** — un proceso vivo pero mudo consume todo el budget sin ser detectado.
2. **`retries = 0` por default** en frontmatter (orchestrator.ts:606) — cada prompt tiene 1 solo intento aunque `DEFAULT_RETRY_POLICY.maxAttempts = 3` exista.
3. **Reintento crea un run nuevo desde el prompt 1** (api/runs/[id]/retry/route.ts:29) — no resume desde el último OK; pierde todo el progreso.
4. **Estado `UNKNOWN`** en clasificación engloba timeouts opacos.
5. **Sin detección de "0 bytes de stdout en X minutos"** — "Esperando salida..." es invisible para el sistema.
6. **`taskkill` en Windows corre sin validar** — procesos huérfanos posibles entre intentos.

## Estructura por dependencias

Cada subcarpeta agrupa prompts según paralelismo seguro (archivos disjuntos = paralelo OK; mismo archivo = secuencial).

```
arreglar_proceso/
├── 00-paralelo-foundation/           ← LANZAR LOS 3 EN PARALELO
│   ├── 01-baseline-tests-y-logging.md       (claude-process.ts + orchestrator.ts)
│   ├── 06-migration-resume-state.md         (SQL migrations + types — disjunto)
│   └── 11-startup-orphan-cleanup.md         (worker/startup-recovery.ts — disjunto)
│
├── 01-secuencial-executor/           ← DESPUÉS DE 00, EN ORDEN
│   ├── 02-idle-timeout-no-output.md         (timeout-manager.ts + claude-process.ts)
│   └── 03-taskkill-validado-windows.md      (timeout-manager.ts — debe correr DESPUÉS de 02)
│
├── 02-secuencial-orchestrator/       ← DESPUÉS DE 00, EN ORDEN
│   ├── 04-retries-default-backoff.md        (orchestrator.ts + frontmatter-schema.ts)
│   ├── 05-clasificador-errores.md           (error-classifier.ts + orchestrator.ts)
│   └── 07-orchestrator-resume.md            (orchestrator.ts — depende de 06 + 05)
│
├── 03-paralelo-resume-surface/       ← DESPUÉS DE 02, LOS 3 EN PARALELO
│   ├── 08-api-retry-resume.md               (web/app/api/runs/[id]/retry — disjunto)
│   ├── 09-ui-retry-modal.md                 (web/components — disjunto)
│   └── 10-heartbeat-por-prompt.md           (worker/run-handler.ts — disjunto)
│
└── 04-final/                          ← AL FINAL DE TODO
    └── 12-e2e-test-resume.md                (e2e/*.spec.ts)
```

## Orden de ejecución sugerido

```
[00-paralelo-foundation]   ← 3 sesiones de Sonnet en paralelo
        ↓
[01-secuencial-executor]   ← 1 sesión, 02 → 03
        ↓                  
[02-secuencial-orchestrator]  ← 1 sesión, 04 → 05 → 07
        ↓
[03-paralelo-resume-surface]  ← 3 sesiones de Sonnet en paralelo
        ↓
[04-final]                 ← validación E2E
```

## Convenciones para todos los prompts

- **Stack:** Next.js (web), Node.js (worker), Supabase (DB), Vitest (unit), Playwright (E2E). NO sugerir alternativas.
- **Git:** todo va a `main` directo. NO branches. NO PRs. NO worktrees. Commit y `git push origin main` al final.
- **Convenciones:** kebab-case archivos, conventional commits (`feat(core): …`, `fix(executor): …`).
- **Verificación obligatoria:** cada prompt debe correr `pnpm test` (o el subset relevante) y pegar output ANTES de declarar éxito. Sin evidencia, no se commitea.
- **Si rompe tests existentes:** STOP. Investigar, no `--no-verify`, no skip. Reportar al usuario.

## Estado de los fixes Windows previos

Ya están aplicados (no tocar a menos que el prompt lo pida):
- `command-builder.ts:104-109` resuelve `claude.exe` directo en Windows con `useShell: false`
- `claude-process.ts` usa `useShell` retornado por `resolveClaudeBinary()`
- `plan-loader.ts` `isPromptRow()` acepta `filename: null`
- DB: `auth_tokens` con `tag`, `key_version`, `revoked_at`, UNIQUE `(user_id, provider)`

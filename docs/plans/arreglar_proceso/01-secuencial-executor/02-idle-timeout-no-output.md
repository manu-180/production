# Prompt 02 — Idle timeout (detectar "no output en X segundos")

## Objetivo
Hoy `TimeoutManager` solo tiene timeout wall-clock global (10min). Un proceso vivo pero callado consume todo el budget sin que nadie sepa que está atascado. Vamos a agregar un **idle timeout** que dispare cuando NO se reciba ningún byte de stdout durante N segundos (default 90s, configurable por prompt). Cuando dispara, mata el proceso y emite un `ExecutorErrorCode` específico (`IDLE_STALL`).

> **Pre-requisito:** prompt 01 (logging baseline) ya merged.

## Contexto a leer ANTES de tocar

1. `packages/core/src/executor/timeout-manager.ts` (109 líneas, completo). Ver `TimeoutManager.start()`, `softThenHard()`, `clear()`. Hoy NO tiene noción de "actividad".
2. `packages/core/src/executor/claude-process.ts`, especialmente:
   - El handler de stdout (donde llegan chunks)
   - Donde se construye y arranca el `TimeoutManager`
   - Donde se mapea `didTimeout=true` → `ExecutorErrorCode.TIMEOUT`
3. `packages/core/src/executor/errors.ts` — lista de `ExecutorErrorCode`. Vamos a agregar `IDLE_STALL`.
4. `packages/core/src/executor/__tests__/timeout-manager.test.ts` — convenciones de test (Vitest, fake timers).

## Cambios concretos

### A. Agregar `IDLE_STALL` a `ExecutorErrorCode` en `errors.ts`

```typescript
export enum ExecutorErrorCode {
  // ...existentes...
  IDLE_STALL = "IDLE_STALL", // Process produced no stdout for >idleTimeoutMs
}
```

Y en cualquier mapper (e.g., `mapSpawnError`, `errorFromExit`) que ya existe, asegurar que IDLE_STALL no se emita por accidente — solo desde el TimeoutManager.

### B. Extender `TimeoutManager` en `timeout-manager.ts`

Agregar:

```typescript
export const DEFAULT_IDLE_TIMEOUT_MS = 90 * 1000;

export interface TimeoutManagerOptions {
  timeoutMs?: number;
  graceMs?: number;
  idleTimeoutMs?: number;          // NEW: 0 o negativo = desactivado
  onSoftKill?: () => void;
  onHardKill?: () => void;
  onTimeout?: () => void;
  onIdleTimeout?: () => void;       // NEW
}
```

Nuevos campos privados:

```typescript
private readonly idleTimeoutMs: number;
private readonly onIdleTimeout?: () => void;
private idleHandle: NodeJS.Timeout | null = null;
private idledOut = false;
```

En `start(pid)`:
- Mantener el wall-clock existente.
- Si `this.idleTimeoutMs > 0`, arrancar también `this.idleHandle = setTimeout(...)` que dispara `onIdleTimeout` y luego `softThenHard(pid)`.

Nuevo método público:

```typescript
/**
 * Llamar cada vez que se recibe stdout. Resetea el idle timer (no el global).
 * Si idle ya disparó o está apagado, no hace nada.
 */
notifyActivity(pid: number | null): void {
  if (this.idleTimeoutMs <= 0) return;
  if (this.idledOut || this.timedOut) return;
  if (this.idleHandle) clearTimeout(this.idleHandle);
  this.idleHandle = setTimeout(() => {
    this.idledOut = true;
    this.onIdleTimeout?.();
    this.softThenHard(pid);
  }, this.idleTimeoutMs);
}
```

En `clear()`: agregar limpieza de `idleHandle`.

Getters:

```typescript
get didIdleTimeout(): boolean { return this.idledOut; }
```

### C. Cablear en `claude-process.ts`

1. En la construcción del `TimeoutManager`, pasar `idleTimeoutMs` desde opts (con default `DEFAULT_IDLE_TIMEOUT_MS`).
2. En el handler de stdout (donde se incrementa `bytesReceived` desde el prompt 01), agregar:
   ```typescript
   timeoutManager.notifyActivity(child.pid);
   ```
3. En el handler de stderr, **también** llamar `notifyActivity` (algunos procesos emiten primero por stderr antes de stdout).
4. En la lógica de exit/cleanup, distinguir:
   - Si `timeoutManager.didIdleTimeout`: emitir `ExecutorError(IDLE_STALL, "no output for ${idleMs}ms")`
   - Si `timeoutManager.didTimeout` (wall-clock): emitir `ExecutorError(TIMEOUT, ...)` (comportamiento existente)
5. Loggear: cuando dispara idle, `logger.warn({ pid, idleMs, bytesReceived }, "claude.process.idle_stall")`.

### D. Permitir override por prompt (frontmatter)

En `packages/core/src/orchestrator/frontmatter-schema.ts`, agregar campo opcional:

```typescript
idleTimeoutMs?: number  // override por prompt; default 90_000
```

Y cablearlo en `orchestrator.ts` cuando construye las `ClaudeCommandOptions` / `TimeoutManagerOptions` para el ejecutor.

## Tests requeridos

### En `timeout-manager.test.ts` (agregar):

1. **Test "idle dispara después de idleTimeoutMs sin actividad"**: usar `vi.useFakeTimers()`, crear TimeoutManager con `idleTimeoutMs=1000`, llamar `start(123)`, avanzar `1100ms`. Esperar `onIdleTimeout` invocado y `didIdleTimeout === true`.
2. **Test "notifyActivity resetea el idle timer"**: igual setup, avanzar `500ms`, llamar `notifyActivity(123)`, avanzar otros `800ms`. NO debe disparar idle (total 1300ms pero el último activity fue hace 800ms < 1000ms).
3. **Test "idle no dispara wall-clock global anticipadamente"**: con `timeoutMs=10000, idleTimeoutMs=1000`, avanzar 1100ms (idle dispara). Verificar que `didTimeout === false` y `didIdleTimeout === true`.
4. **Test "idleTimeoutMs=0 desactiva idle"**: avanzar 60s. `didIdleTimeout === false`, `notifyActivity` no hace nada.
5. **Test "clear() limpia idleHandle"**: arrancar, llamar `clear()`, avanzar 5s. No debe disparar callbacks.

### En `claude-process.test.ts` (agregar):

1. **Test "proceso sin output → IDLE_STALL"**: mockear spawn que NO emite stdout, NO termina por su cuenta. Setear `idleTimeoutMs=200`. Avanzar timers >300ms. Esperar que `result.error.code === ExecutorErrorCode.IDLE_STALL`.
2. **Test "proceso que emite cada 100ms NO dispara idle de 200ms"**: mock que emite `"."` cada 100ms durante 1s. Verificar `IDLE_STALL` no dispara.
3. **Test "stderr cuenta como actividad"**: proceso que emite stderr cada 100ms y nunca stdout. `idleTimeoutMs=300`. NO debe disparar idle.

## Criterios de aceptación

```bash
pnpm --filter @conductor/core test timeout-manager
# todos los tests existentes + 5 nuevos en verde

pnpm --filter @conductor/core test claude-process
# todos los tests + 3 nuevos en verde

pnpm --filter @conductor/core test
# nada roto

# Verificación manual:
# Crear un prompt de prueba con `idleTimeoutMs: 5000` en frontmatter, que
# corra `sleep 60` (no emite output). En ~5s debe matarse y aparecer en logs:
#   claude.process.idle_stall
#   ExecutorError code=IDLE_STALL
```

## Restricciones

- **NO** cambiar el comportamiento del wall-clock timeout existente. Solo agregar idle al lado.
- **NO** llamar `notifyActivity` desde el progress-heartbeat del prompt 01 — el heartbeat reporta cada 30s pero idle debe basarse en bytes REALES recibidos.
- **NO** cambiar el default de `idleTimeoutMs` a algo menor a 60s — Claude puede pensar mucho tiempo entre tokens en prompts complejos. 90s es el mínimo prudente.
- **NO** romper la API de `TimeoutManagerOptions` — los nuevos campos son opcionales.
- **NO** tocar `command-builder.ts` (ya está bien). NO tocar el resolveWindowsClaudeExe.

## Commit

```
feat(executor): add idle timeout (no-output stall detection)

- TimeoutManager.notifyActivity() resets an idle timer per stdout/stderr chunk
- when idle timer fires (default 90s), process is killed with IDLE_STALL code
- idleTimeoutMs configurable per prompt via frontmatter
- new ExecutorErrorCode.IDLE_STALL distinguishes from wall-clock TIMEOUT
- 5 new TimeoutManager tests + 3 new ClaudeProcess tests
```

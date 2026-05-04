# Prompt 03 — Taskkill validado en Windows (matar de verdad, verificar, fallback)

## Objetivo
Hoy `softKill`/`hardKill` en `timeout-manager.ts` hacen `spawn("taskkill", ...)` con `child.unref()` y silencian errores. Si taskkill falla (proceso protegido, permisos, PID ya muerto), nadie se entera y queda un proceso huérfano que pisa archivos del workspace en el próximo intento. Vamos a:

1. Esperar el exit code de taskkill (no `unref`).
2. Si después de hard-kill el PID sigue vivo (`tasklist /FI "PID eq X"`), loggear `level=error` con detalle.
3. Fallback a PowerShell `Stop-Process -Force` si taskkill falla.

> **Pre-requisito:** prompt 02 (idle timeout) ya merged. Ambos tocan timeout-manager.ts pero zonas distintas — al haberlo hecho secuencial evitamos conflictos.

## Contexto a leer ANTES de tocar

1. `packages/core/src/executor/timeout-manager.ts` — funciones `softKill` y `hardKill` (líneas 67-109). Ver cómo está hoy.
2. `packages/core/src/executor/__tests__/timeout-manager.test.ts` — patrones de mock para `child_process.spawn`.
3. El prompt 11 (orphan-cleanup) — si ya está implementado, **reusar** `killProcessTree` de `apps/worker/src/lib/orphan-cleanup.ts` mediante export desde `@conductor/core/utils/process-kill.ts`. Si no está, NO crear dependencia circular: implementar acá la versión robusta y dejar que orphan-cleanup la consuma desde `@conductor/core` después.

## Cambios concretos

### A. Crear helper `packages/core/src/utils/process-kill.ts`

(Si ya existe `packages/core/src/utils/`, agregar archivo. Si no, crear el directorio.)

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../logger.js";

const execFileAsync = promisify(execFile);

const TASKKILL_TIMEOUT_MS = 5_000;
const TASKLIST_TIMEOUT_MS = 3_000;

/**
 * Verifica si un PID está vivo en Windows. Retorna true si vivo, false si muerto.
 * Si la consulta falla (timeout, error), retorna `null` (desconocido).
 */
export async function isPidAliveWindows(pid: number): Promise<boolean | null> {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    const { stdout } = await execFileAsync(
      "tasklist",
      ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"],
      { windowsHide: true, timeout: TASKLIST_TIMEOUT_MS },
    );
    // Si encuentra: línea CSV con el proceso; si no: línea "INFO: No tasks..."
    return /^"[^"]+","\d+"/m.test(stdout);
  } catch (err) {
    logger.warn({ err, pid }, "process-kill.is_pid_alive_failed");
    return null;
  }
}

/**
 * Mata el árbol de procesos en Windows con verificación.
 * Estrategia:
 *  1. taskkill /T /F /PID <pid> y esperar exit code
 *  2. Verificar con tasklist que efectivamente murió
 *  3. Si sigue vivo, fallback a PowerShell Stop-Process -Force -Id <pid>
 *  4. Verificar de nuevo. Si sigue vivo, log level=error.
 *
 * Retorna:
 *  - "killed": confirmado muerto
 *  - "already_dead": tasklist no lo encuentra
 *  - "still_alive": ambos métodos fallaron, sigue vivo
 *  - "unknown": no se pudo verificar
 */
export type KillTreeResult = "killed" | "already_dead" | "still_alive" | "unknown";

export async function killProcessTreeWindowsVerified(pid: number): Promise<KillTreeResult> {
  if (!Number.isInteger(pid) || pid <= 0) return "already_dead";

  // Step 1: taskkill /T /F
  let taskkillOk = false;
  try {
    await execFileAsync("taskkill", ["/F", "/T", "/PID", String(pid)], {
      windowsHide: true,
      timeout: TASKKILL_TIMEOUT_MS,
    });
    taskkillOk = true;
  } catch (err) {
    logger.warn({ err, pid }, "process-kill.taskkill_failed");
  }

  // Step 2: verify
  const aliveAfterTaskkill = await isPidAliveWindows(pid);
  if (aliveAfterTaskkill === false) {
    logger.info({ pid, taskkillOk }, "process-kill.verified_dead");
    return taskkillOk ? "killed" : "already_dead";
  }

  // Step 3: fallback to PowerShell
  logger.warn({ pid }, "process-kill.fallback_powershell");
  try {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Stop-Process -Force -Id ${pid} -ErrorAction SilentlyContinue`,
      ],
      { windowsHide: true, timeout: TASKKILL_TIMEOUT_MS },
    );
  } catch (err) {
    logger.error({ err, pid }, "process-kill.powershell_failed");
  }

  // Step 4: re-verify
  const finalAlive = await isPidAliveWindows(pid);
  if (finalAlive === false) {
    return "killed";
  }
  if (finalAlive === true) {
    logger.error({ pid }, "process-kill.still_alive_after_all_attempts");
    return "still_alive";
  }
  return "unknown";
}
```

### B. Modificar `timeout-manager.ts` para usar el helper

Mantener `softKill`/`hardKill` (algunos tests pueden depender de su signature), PERO:

1. Cambiar `hardKill` para que en Windows llame a `killProcessTreeWindowsVerified` y NO use `unref`.
2. Mantener Linux/macOS sin cambios (process.kill SIGKILL).
3. `softKill` en Windows: cambiar a `taskkill /T /PID <pid>` (sin `/F`) con `await` del exit code y log estructurado.

Reemplazar las funciones por:

```typescript
import { killProcessTreeWindowsVerified } from "../utils/process-kill.js";

export async function softKillAsync(pid: number | null): Promise<void> {
  if (pid === null || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      await execFileAsync("taskkill", ["/T", "/PID", String(pid)], {
        windowsHide: true,
        timeout: 5_000,
      });
      logger.info({ pid }, "timeout-manager.soft_kill.sent");
    } catch (err) {
      logger.warn({ err, pid }, "timeout-manager.soft_kill.failed");
    }
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already dead
  }
}

export async function hardKillAsync(pid: number | null): Promise<void> {
  if (pid === null || pid <= 0) return;
  if (process.platform === "win32") {
    const result = await killProcessTreeWindowsVerified(pid);
    logger.info({ pid, result }, "timeout-manager.hard_kill.done");
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already dead
  }
}

// BC: keep sync versions but make them fire-and-forget the async impl.
// Used internally by setTimeout callbacks where awaiting isn't possible.
export function softKill(pid: number | null): void {
  void softKillAsync(pid);
}
export function hardKill(pid: number | null): void {
  void hardKillAsync(pid);
}
```

### C. Cablear en `softThenHard()`

Cambiar de:
```typescript
softThenHard(pid: number | null): void {
  this.onSoftKill?.();
  softKill(pid);
  this.graceHandle = setTimeout(() => {
    this.onHardKill?.();
    hardKill(pid);
  }, this.graceMs);
}
```

A versión que async-internal pero mantiene signature sincrónica:

```typescript
softThenHard(pid: number | null): void {
  this.onSoftKill?.();
  void softKillAsync(pid);  // fire-and-forget, log captures result
  this.graceHandle = setTimeout(() => {
    this.onHardKill?.();
    void hardKillAsync(pid);
  }, this.graceMs);
}
```

## Tests requeridos

Crear `packages/core/src/utils/__tests__/process-kill.test.ts`:

1. **Test "isPidAliveWindows con pid<=0 retorna false sin llamar tasklist"**: spy en execFile, esperar 0 calls.
2. **Test "isPidAliveWindows parsea CSV de tasklist correctamente"**: mockear execFile para retornar `"claude.exe","1234","Console","1","100,000 K"`. Esperar `true`.
3. **Test "isPidAliveWindows retorna false con 'INFO: No tasks running'"**: mockear stdout `"INFO: No tasks are running which match the specified criteria.\n"`. Esperar `false`.
4. **Test "killProcessTreeWindowsVerified retorna already_dead si taskkill falla y verify dice muerto"**: mockear taskkill que tira error, isPidAliveWindows que retorna `false`. Esperar `"already_dead"` y log `verified_dead`.
5. **Test "killProcessTreeWindowsVerified usa fallback PowerShell si taskkill no mata"**: mockear taskkill OK, primera verify `true` (sigue vivo), Stop-Process OK, segunda verify `false`. Esperar `"killed"` y log `fallback_powershell`.
6. **Test "killProcessTreeWindowsVerified retorna still_alive si todo falla"**: ambos métodos fallan y verify sigue dando `true`. Esperar `"still_alive"` y log `level=error` `still_alive_after_all_attempts`.

En `timeout-manager.test.ts` (agregar):

1. **Test "softThenHard no usa unref (no fire-and-forget silencioso)"**: spy en execFile, llamar softThenHard, esperar que execFile fue llamado con timeout (no sin esperar).

## Criterios de aceptación

```bash
pnpm --filter @conductor/core test process-kill
# 6 tests en verde

pnpm --filter @conductor/core test timeout-manager
# tests del prompt 02 + 1 nuevo de este, todos en verde

pnpm --filter @conductor/core test
# nada roto

# Verificación manual (Windows):
# 1. Iniciar un proceso bloqueante: `start /B claude.exe -p "loop forever fake"` o similar
# 2. Anotar PID con `tasklist /FI "IMAGENAME eq claude.exe"`
# 3. En código: import { killProcessTreeWindowsVerified } from ...
# 4. Llamar y verificar que retorna "killed" y log `verified_dead`
# 5. Re-correr tasklist: el PID NO debe aparecer
```

## Restricciones

- **NO** romper Linux/macOS — sus paths de SIGTERM/SIGKILL quedan idénticos.
- **NO** quitar las funciones sincrónicas `softKill`/`hardKill` — pueden ser usadas por otros callers.
- **NO** usar `wmic` (deprecated). PowerShell + tasklist solamente.
- **NO** dejar `child.unref()` en ninguna parte del flujo de hard-kill — si no esperamos el exit, no podemos verificar.
- **NO** levantar el timeout de taskkill por encima de 5s — si tarda más, hay algo más roto.

## Commit

```
fix(executor): verified taskkill on Windows with PowerShell fallback

- new utils/process-kill.ts: killProcessTreeWindowsVerified() with
  taskkill /F /T → tasklist verify → PowerShell Stop-Process fallback
- timeout-manager softKill/hardKill use new async helpers, no more unref
- structured logs at every step (sent, failed, fallback, still_alive)
- 6 new unit tests for process-kill + 1 for timeout-manager
- prevents orphan claude.exe holding workspace files between retry attempts
```

# Prompt 11 — Cleanup de procesos huérfanos al startup del worker

## Objetivo
Cuando el worker arranca (después de un crash o reinicio), debe matar cualquier proceso `claude.exe` (o `claude` en Linux/macOS) que haya quedado huérfano del run anterior, antes de tomar trabajo nuevo. Esto evita procesos zombi consumiendo recursos y pisando archivos del workspace.

## Contexto a leer ANTES de tocar

1. `apps/worker/src/startup-recovery.ts` (completo) — entender qué hace hoy: probablemente busca runs en estado `running` con heartbeat viejo y los mueve a `queued` o `failed`. El cleanup de procesos va aquí o en módulo aparte llamado desde aquí.
2. `apps/worker/src/index.ts` — ver dónde se invoca `startup-recovery` (debe ser ANTES de empezar a tomar trabajo).
3. `packages/core/src/logger.ts` — usar este logger.
4. Verificar si el proyecto ya tiene helpers para `tasklist`/`ps`. Buscar:
   ```bash
   grep -rn "tasklist\|child_process.*ps " --include="*.ts" packages apps
   ```

## Cambios concretos

### A. Nuevo módulo: `apps/worker/src/lib/orphan-cleanup.ts`

Estructura:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "@conductor/core/logger";

const execFileAsync = promisify(execFile);

interface ClaudeProcess {
  pid: number;
  parentPid: number;
  commandLine: string;
}

/**
 * Lista todos los procesos claude.exe (Win) o claude (Linux/macOS) corriendo
 * en la máquina. Retorna [] si no hay ninguno o si la consulta falla.
 */
export async function listClaudeProcesses(): Promise<ClaudeProcess[]> {
  if (process.platform === "win32") {
    return listWindows();
  }
  return listUnix();
}

async function listWindows(): Promise<ClaudeProcess[]> {
  try {
    // wmic está deprecated en Windows 11+, usar PowerShell.
    // Fallback a tasklist si PowerShell no está disponible.
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, timeout: 10_000 }
    );
    const trimmed = stdout.trim();
    if (trimmed.length === 0) return [];
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((p: { ProcessId: number; ParentProcessId: number; CommandLine: string | null }) => ({
      pid: p.ProcessId,
      parentPid: p.ParentProcessId,
      commandLine: p.CommandLine ?? "",
    }));
  } catch (err) {
    logger.warn({ err }, "orphan-cleanup.list_windows.failed");
    return [];
  }
}

async function listUnix(): Promise<ClaudeProcess[]> {
  try {
    const { stdout } = await execFileAsync("ps", ["-eo", "pid,ppid,comm,args"], {
      timeout: 10_000,
    });
    const lines = stdout.split("\n").slice(1); // skip header
    const processes: ClaudeProcess[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const match = trimmed.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      if (!match) continue;
      const [, pid, ppid, comm, args] = match;
      if (comm === "claude" || (args && args.includes("claude"))) {
        processes.push({
          pid: Number(pid),
          parentPid: Number(ppid),
          commandLine: args ?? "",
        });
      }
    }
    return processes;
  } catch (err) {
    logger.warn({ err }, "orphan-cleanup.list_unix.failed");
    return [];
  }
}

/**
 * Mata el proceso (y árbol en Windows) sin esperar respuesta. Retorna
 * `true` si el comando se lanzó, `false` si hubo error.
 */
export async function killProcessTree(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    if (process.platform === "win32") {
      await execFileAsync("taskkill", ["/F", "/T", "/PID", String(pid)], {
        windowsHide: true,
        timeout: 5_000,
      });
    } else {
      process.kill(pid, "SIGKILL");
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Mata todos los procesos claude detectados al startup. NO discrimina por
 * parent — el supuesto es que si el worker arrancó recién, no debería existir
 * NINGÚN claude vivo aún. Si el usuario corre claude manualmente desde otra
 * terminal, ese proceso también muere — documentado como trade-off aceptable
 * (el worker no debe coexistir con uso manual del CLI).
 */
export async function cleanupOrphanClaudeProcesses(): Promise<{ found: number; killed: number }> {
  const procs = await listClaudeProcesses();
  if (procs.length === 0) {
    logger.info({}, "orphan-cleanup.none_found");
    return { found: 0, killed: 0 };
  }

  logger.warn(
    { count: procs.length, pids: procs.map((p) => p.pid) },
    "orphan-cleanup.found_orphans",
  );

  let killed = 0;
  for (const p of procs) {
    const ok = await killProcessTree(p.pid);
    if (ok) killed += 1;
    logger.info(
      { pid: p.pid, parentPid: p.parentPid, killed: ok },
      "orphan-cleanup.kill_attempt",
    );
  }

  return { found: procs.length, killed };
}
```

### B. Llamar el cleanup desde startup-recovery

En `apps/worker/src/startup-recovery.ts`, **al inicio** (antes de tocar DB):

```typescript
import { cleanupOrphanClaudeProcesses } from "./lib/orphan-cleanup.js";

export async function runStartupRecovery(...) {
  // FIRST: kill orphan claude processes from previous worker crash.
  await cleanupOrphanClaudeProcesses();

  // ...resto del código existente (reset stale runs, etc.)
}
```

Si la función actual no es async, hacerla async. Si se exporta con otro nombre, mantener compatibilidad.

## Tests requeridos

Crear `apps/worker/src/lib/__tests__/orphan-cleanup.test.ts`:

1. **Test "listClaudeProcesses retorna [] si execFile falla"**: mockear `child_process.execFile` para que tire error. Esperar `[]` y log warn.
2. **Test "killProcessTree retorna false con pid inválido"**: pasar `0`, `-1`, `NaN`. Esperar `false` cada vez sin lanzar.
3. **Test "cleanupOrphanClaudeProcesses loggea found_orphans con count"**: mockear `listClaudeProcesses` para retornar `[{pid:1234, ...}, {pid:5678, ...}]` y `killProcessTree` para retornar `true`. Esperar log `orphan-cleanup.found_orphans` con `count:2`, return `{found:2, killed:2}`.
4. **Test "cleanupOrphanClaudeProcesses con 0 procs loggea none_found"**: mockear `listClaudeProcesses` para retornar `[]`. Esperar return `{found:0, killed:0}`.

NO testear contra el SO real (no spawnear claude real en tests).

## Criterios de aceptación

```bash
pnpm --filter @conductor/worker test orphan-cleanup
# 4 tests en verde

pnpm --filter @conductor/worker test
# todos los tests del worker pasan

# Verificación manual (Windows):
# 1. Arrancar `claude.exe -p "hello"` manualmente (queda corriendo)
# 2. Verificar con `tasklist /FI "IMAGENAME eq claude.exe"` que está vivo
# 3. Arrancar el worker: pnpm --filter @conductor/worker dev
# 4. En logs debe aparecer: orphan-cleanup.found_orphans con count:1
# 5. Re-verificar tasklist: el proceso debe haber muerto
```

## Restricciones

- **NO** matar procesos que no sean `claude.exe` / `claude`. Filtro estricto por nombre de imagen.
- **NO** correr el cleanup periódicamente — solo una vez al startup. Procesos legítimos del worker actual NO deben matarse.
- **NO** bloquear el startup más de 15 segundos por este cleanup (timeout de 10s en cada execFile + safety total).
- **NO** usar `wmic` (deprecated en Win11 24H2+). Usar PowerShell `Get-CimInstance`.
- **NO** importar dependencias nuevas (solo `node:child_process`, `node:util` y el logger existente).

## Commit

```
feat(worker): kill orphan claude processes on startup

- new lib/orphan-cleanup.ts: lists and kills stale claude.exe / claude processes
- runs once at startup BEFORE picking up work
- uses PowerShell Get-CimInstance on Windows (wmic deprecated), ps on Unix
- logs orphan-cleanup.found_orphans with count + pids when detected
- 4 unit tests covering happy path + error fallbacks
```

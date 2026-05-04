# Prompt 10 — Heartbeat granular por prompt + recovery de prompts atascados

## Objetivo
Hoy el worker emite heartbeat cada 15s en `worker_instances.last_seen_at`, pero NO hay heartbeat por prompt. Si el worker arranca un prompt y queda colgado (proceso vivo, idle timeout no dispara, no crashea), nadie se entera hasta el wall-clock timeout (10min). Vamos a:

1. Agregar columna `prompt_executions.last_progress_at TIMESTAMPTZ`.
2. El worker (en run-handler) actualiza `last_progress_at = now()` cada 5s mientras el prompt está corriendo (mientras hay actividad — si idle, no actualiza).
3. Startup-recovery (al arrancar otro worker) detecta `prompt_executions` con `status='running'` y `last_progress_at < now() - interval '2 minutes'` → marca como `failed` con `error_code='STALE_HEARTBEAT'` y libera el run.

> **Pre-requisito:** prompt 06 (migration ya creada — necesitamos otra mini-migration para esta columna). Independiente de 08 y 09 (file ownership disjunto).

## Contexto a leer ANTES de tocar

1. `apps/worker/src/run-handler.ts` (completo) — entender el ciclo de vida de un prompt en el worker.
2. `apps/worker/src/heartbeat.ts` — patrón actual de heartbeat (intervals, cleanup).
3. `apps/worker/src/startup-recovery.ts` — patrón actual de detección de runs stale.
4. La definición actual de `prompt_executions` en migrations (buscar la migration que la crea).
5. `packages/core/src/orchestrator/orchestrator.ts` líneas 600-650 — donde se inserta el row de attempt y donde se emiten progress events.

## Cambios concretos

### A. Mini-migration: `<TIMESTAMP>_prompt_executions_heartbeat.sql`

```sql
ALTER TABLE prompt_executions
  ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS prompt_executions_running_progress_idx
  ON prompt_executions (status, last_progress_at)
  WHERE status = 'running';

COMMENT ON COLUMN prompt_executions.last_progress_at IS
  'Worker actualiza esto cada 5s mientras el prompt corre (hay actividad). Recovery detecta atascos si esto < now() - 2 min.';
```

Regenerar tipos:
```bash
pnpm --filter @conductor/db gen-types
```

### B. Heartbeat por prompt en `run-handler.ts` (o donde corra el orchestrator del worker)

Cuando el worker arranca un prompt, abrir un interval que actualiza `last_progress_at` cada 5s. El interval debe **respetar la actividad real**: solo actualiza si hubo bytes recibidos desde la última actualización.

Crear helper `apps/worker/src/lib/prompt-heartbeat.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@conductor/core/logger";

const HEARTBEAT_INTERVAL_MS = 5_000;

export interface PromptHeartbeat {
  /** Llamar cada vez que se recibe stdout/stderr del proceso. */
  notifyActivity(): void;
  /** Detener el heartbeat (al terminar el prompt). */
  stop(): void;
}

/**
 * Inicia un heartbeat que actualiza prompt_executions.last_progress_at cada 5s
 * SI hubo actividad desde la última actualización. Si no hubo, no hace UPDATE
 * (deja que startup-recovery detecte el atasco eventualmente).
 */
export function startPromptHeartbeat(
  db: SupabaseClient,
  promptExecutionId: string,
): PromptHeartbeat {
  let activitySinceLastTick = true; // initial true → primer tick siempre updatea

  const handle = setInterval(() => {
    void (async () => {
      if (!activitySinceLastTick) return;
      activitySinceLastTick = false;
      const { error } = await db
        .from("prompt_executions")
        .update({ last_progress_at: new Date().toISOString() })
        .eq("id", promptExecutionId);
      if (error) {
        logger.warn(
          { err: error, promptExecutionId },
          "prompt-heartbeat.update_failed",
        );
      }
    })();
  }, HEARTBEAT_INTERVAL_MS);

  return {
    notifyActivity(): void {
      activitySinceLastTick = true;
    },
    stop(): void {
      clearInterval(handle);
    },
  };
}
```

Cablearlo en `run-handler.ts`:

1. Después de insertar el `prompt_executions` row del attempt (capturar el `id`), llamar:
   ```typescript
   const heartbeat = startPromptHeartbeat(db, promptExecutionId);
   ```
2. Pasar la callback `heartbeat.notifyActivity` al executor — debe llamarse cada vez que llega stdout/stderr (mismo lugar que `timeoutManager.notifyActivity` del prompt 02).
3. En el cleanup del prompt (success o failure):
   ```typescript
   heartbeat.stop();
   ```

Si el orchestrator está en `packages/core` (no en worker), exportar `startPromptHeartbeat` desde `@conductor/core/observability/prompt-heartbeat.ts` para que el orchestrator también lo pueda invocar — verificar dónde está mejor.

### C. Recovery: detectar y liberar atascos en `startup-recovery.ts`

Agregar **después** del orphan-cleanup del prompt 11 (si está mergeado) y **antes** de tomar trabajo nuevo:

```typescript
const STALE_HEARTBEAT_THRESHOLD_MS = 2 * 60 * 1000;

async function reapStalePromptExecutions(db: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_HEARTBEAT_THRESHOLD_MS).toISOString();

  const { data, error } = await db
    .from("prompt_executions")
    .update({
      status: "failed",
      error_code: "STALE_HEARTBEAT",
      error_message: `No heartbeat for >${STALE_HEARTBEAT_THRESHOLD_MS / 1000}s`,
      finished_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("last_progress_at", cutoff)
    .select("id, run_id, prompt_index");

  if (error) {
    logger.error({ err: error }, "startup-recovery.reap_stale.failed");
    return 0;
  }

  if (data && data.length > 0) {
    logger.warn(
      { count: data.length, items: data },
      "startup-recovery.reaped_stale_prompts",
    );

    // Cada run afectado debe ser marcado como 'failed' también, para que
    // el siguiente retry pueda resumir.
    const runIds = Array.from(new Set(data.map((r) => r.run_id)));
    for (const runId of runIds) {
      await db
        .from("runs")
        .update({ status: "failed" })
        .eq("id", runId)
        .eq("status", "running");
    }
  }

  return data?.length ?? 0;
}
```

Y llamarlo desde `runStartupRecovery`:
```typescript
await reapStalePromptExecutions(db);
```

## Tests requeridos

Crear `apps/worker/src/lib/__tests__/prompt-heartbeat.test.ts`:

1. **Test "no actualiza si no hay actividad"**: `vi.useFakeTimers`, crear heartbeat, NO llamar `notifyActivity`, avanzar 6s. Mock supabase: 0 calls.
2. **Test "actualiza cada 5s si hay actividad continua"**: llamar `notifyActivity` cada 1s durante 16s. Esperar al menos 3 calls a UPDATE.
3. **Test "stop() limpia el interval"**: arrancar, stop, avanzar 30s. 0 calls después de stop.
4. **Test "actualiza solo si flag de actividad está set, lo limpia tras update"**: notify una vez, avanzar 6s → 1 update; avanzar otros 6s sin notify → sigue 1 update.

Crear/extender tests de `startup-recovery.ts`:

1. **Test "reapStalePromptExecutions marca como failed los stale"**: mock DB con 2 prompt_executions running, una con `last_progress_at = now-3min`, otra con `now-30s`. Esperar UPDATE solo en la primera, con `error_code='STALE_HEARTBEAT'`.
2. **Test "marca el run padre como failed"**: la stale apunta a run_id='r1' status='running'. Esperar UPDATE en runs WHERE id='r1' status='running' → status='failed'.

## Criterios de aceptación

```bash
pnpm --filter @conductor/worker test prompt-heartbeat
# 4 tests verdes

pnpm --filter @conductor/worker test startup-recovery
# tests existentes + 2 nuevos verdes

pnpm --filter @conductor/worker test
# global verde

# Verificación end-to-end manual:
# 1. Arrancar worker. Lanzar un run de un plan con un prompt largo (e.g. 30s).
# 2. En DB: SELECT id, status, last_progress_at FROM prompt_executions WHERE status='running'
#    Esperado: last_progress_at se actualiza ~cada 5s mientras corre
# 3. Forzar atasco: kill -9 al worker mid-prompt (deja la fila en 'running').
# 4. Esperar 3 min.
# 5. Reiniciar worker. En logs:
#    startup-recovery.reaped_stale_prompts count:1
# 6. SELECT status, error_code FROM prompt_executions WHERE id=<stale>
#    Esperado: status='failed', error_code='STALE_HEARTBEAT'
# 7. SELECT last_succeeded_prompt_index FROM runs WHERE id=<run>
#    Si el prompt 0 había terminado OK, debe ser 0; el run debe estar en status='failed'
#    listo para retry/resume.
```

## Restricciones

- **NO** actualizar `last_progress_at` desde el orchestrator si hay 0 actividad real — esto enmascara atascos.
- **NO** poner el threshold de `STALE_HEARTBEAT` por debajo de 2 minutos — Claude legítimamente puede pensar 60-90s entre tokens. 2 min es el mínimo prudente para estar 2x por encima del idle_timeout default (90s del prompt 02).
- **NO** hacer el heartbeat parte del wall-clock timeout. Son sistemas separados.
- **NO** usar `setInterval` sin guardar el handle — debe ser cleanable.
- **NO** spawnear más conexiones a Supabase de las necesarias — reusar el cliente del worker.

## Commit

```
feat(worker): per-prompt heartbeat + stale-prompt reaper at startup

- new column prompt_executions.last_progress_at
- worker updates it every 5s while there's stdout/stderr activity
- startup-recovery reaps prompts with no heartbeat for >2 min:
  marks them failed with error_code=STALE_HEARTBEAT and frees their runs
- 4 unit tests for the heartbeat helper + 2 for the reaper
- closes the gap where a hung worker leaves a prompt in 'running' forever
```

# Prompt 07 — Orchestrator: arrancar desde `resume_from_index` y trackear `last_succeeded_prompt_index`

## Objetivo
Hoy el orchestrator (`orchestrator.ts:542-543`) itera `sortedPrompts` desde el índice 0, sin importar el estado del run. Vamos a:

1. Si `runs.resume_from_index != null`, saltar todos los prompts con índice < `resume_from_index` (marcándolos como `skipped` en `prompt_executions` para auditoría).
2. Si `runs.resume_session_id != null`, pasar ese session_id como `--resume` al PRIMER prompt no-saltado (continuidad de contexto Claude).
3. Después de cada prompt exitoso, actualizar `runs.last_succeeded_prompt_index = currentIndex`.
4. Al completar el run (success o failure), limpiar `resume_from_index` y `resume_session_id` (ya cumplieron su función — el siguiente retry mira `last_succeeded_prompt_index`).

> **Pre-requisitos:** prompts 04 + 05 (orchestrator ya editado) + 06 (migration con las 3 columnas) ya merged. **Crítico:** sin la migration del prompt 06, este código no compila por los tipos generados.

## Contexto a leer ANTES de tocar

1. `packages/core/src/orchestrator/orchestrator.ts` líneas 530-600 (carga del run + setup) y líneas 542-545 (loop sobre prompts).
2. La interfaz/tipo de `ExecutionContext` en `packages/core/src/orchestrator/execution-context.ts` — ver qué campos del run están disponibles para el orchestrator.
3. `packages/core/src/orchestrator/orchestrator.ts` líneas 780-800 — donde se persiste `lastSessionId` después de prompt exitoso.
4. Tipos regenerados de Supabase (`Database["public"]["Tables"]["runs"]["Row"]`) — confirmar que `resume_from_index`, `resume_session_id`, `last_succeeded_prompt_index` ya están.
5. `packages/core/src/orchestrator/__tests__/orchestrator.test.ts` — patrón para mockear DB y prompts.

## Cambios concretos

### A. Leer resume state al inicio del run

En `orchestrator.ts`, en la función principal (donde se carga el run de DB, ~línea 540):

```typescript
const resumeFromIndex = run.resume_from_index ?? 0;
const initialResumeSessionId = run.resume_session_id ?? undefined;

if (resumeFromIndex > 0) {
  logger.info(
    {
      runId,
      resumeFromIndex,
      totalPrompts: sortedPrompts.length,
      hasSessionId: initialResumeSessionId !== undefined,
    },
    "orchestrator.resume.starting",
  );
}
```

### B. Saltar prompts con índice < resumeFromIndex

Cambiar el loop `for (let i = 0; i < sortedPrompts.length; i++)` (o el for-of equivalente) a:

```typescript
for (let i = 0; i < sortedPrompts.length; i++) {
  const prompt = sortedPrompts[i];

  // Resume: skip prompts before the resume index
  if (i < resumeFromIndex) {
    await markPromptSkipped(db, runId, prompt.id, i, "resumed_from_index");
    logger.info({ runId, promptIndex: i, promptName: prompt.name }, "orchestrator.prompt.skipped");
    continue;
  }

  // ...resto del flujo existente (attempts, etc.)
}
```

Crear el helper `markPromptSkipped` en el mismo archivo o `orchestrator/db-helpers.ts`:

```typescript
async function markPromptSkipped(
  db: SupabaseClient,
  runId: string,
  promptId: string,
  index: number,
  reason: string,
): Promise<void> {
  const { error } = await db.from("prompt_executions").insert({
    run_id: runId,
    prompt_id: promptId,
    prompt_index: index,
    status: "skipped",
    error_code: reason,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    attempt: 0,
  });
  if (error) {
    logger.warn({ err: error, runId, promptId }, "orchestrator.mark_skipped.failed");
  }
}
```

(Si la tabla `prompt_executions` no acepta `status='skipped'`, agregar al constraint en una **mini-migration adicional** dentro de este prompt. Verificar primero.)

### C. Pasar resume_session_id al primer prompt no saltado

Hoy `context.lastSessionId` se setea cuando un prompt termina exitosamente. Inicializarlo al arranque:

```typescript
let lastSessionId: string | undefined = initialResumeSessionId;
```

Y en la construcción de `ClaudeCommandOptions` (donde ya pasa `resumeSessionId`), seguir igual — `lastSessionId` se va sobrescribiendo cuando llegan resultados nuevos.

**Importante:** después de usarlo en el primer prompt no-saltado, en éxito guardar el NUEVO session_id (lo que ya pasa). En fallo, NO sobrescribir (queremos mantener el session anterior para el próximo retry, no perderlo).

### D. Actualizar `last_succeeded_prompt_index` después de cada prompt OK

Donde hoy se hace el update final exitoso del prompt (línea ~842), agregar update al run:

```typescript
const { error: updErr } = await db
  .from("runs")
  .update({ last_succeeded_prompt_index: i })
  .eq("id", runId)
  .lt("last_succeeded_prompt_index", i)  // solo subir, nunca bajar
  .or(`last_succeeded_prompt_index.is.null,last_succeeded_prompt_index.lt.${i}`);
if (updErr) {
  logger.warn({ err: updErr, runId, promptIndex: i }, "orchestrator.update_last_succeeded.failed");
}
```

(El filtro `.lt(...).or(...)` es redundante; usar el que sea más limpio en SQL — el punto es no bajar el índice si por alguna razón se procesan prompts fuera de orden.)

### E. Limpiar resume state al final del run

En el cleanup de fin-de-run (success O failure terminal), agregar:

```typescript
await db
  .from("runs")
  .update({
    resume_from_index: null,
    resume_session_id: null,
  })
  .eq("id", runId);
```

Esto deja la fila lista para el próximo retry: `last_succeeded_prompt_index` queda con el valor real, `resume_*` quedan en NULL.

## Tests requeridos

En `packages/core/src/orchestrator/__tests__/orchestrator.test.ts`:

1. **Test "run con resume_from_index=0 corre todos los prompts (no skip)"**: setup run con `resume_from_index: 0`, plan de 3 prompts, todos OK. Verificar que se ejecutaron 3, ninguno skipped.
2. **Test "run con resume_from_index=2 saltea prompts 0 y 1"**: plan de 4 prompts. Verificar:
   - 2 filas en `prompt_executions` con `status='skipped'`, `error_code='resumed_from_index'`
   - 2 filas con `status='succeeded'` (índices 2 y 3)
   - El executor solo se llamó 2 veces.
3. **Test "resume_session_id se pasa al primer prompt no saltado"**: setup `resume_session_id: 'sess_abc'`, `resume_from_index: 1`. Verificar que el call al executor para prompt index 1 incluye `resumeSessionId: 'sess_abc'`. Para prompt index 2, debe usar el session_id retornado por prompt 1 (no más 'sess_abc').
4. **Test "last_succeeded_prompt_index se actualiza tras cada éxito"**: plan de 3 prompts, todos OK. Verificar updates secuenciales: 0, 1, 2.
5. **Test "last_succeeded_prompt_index queda en N si prompt N+1 falla terminalmente"**: plan de 3, prompt 2 falla todos los attempts. Verificar `last_succeeded_prompt_index = 1` al final.
6. **Test "resume_from_index y resume_session_id se limpian al final del run"**: setup con valores no-null. Al terminar run, verificar UPDATE a NULL.

## Criterios de aceptación

```bash
pnpm --filter @conductor/core test orchestrator
# tests de prompts 04, 05 + 6 nuevos, todos verdes

pnpm --filter @conductor/core test
# global verde

# Verificación end-to-end manual (con MCP supabase):
# 1. Crear un run nuevo con resume_from_index=2, plan de 5 prompts
# 2. Arrancar worker
# 3. Ver en DB:
#    SELECT prompt_index, status, error_code FROM prompt_executions WHERE run_id=...
#    Esperado: índices 0,1 → skipped/resumed_from_index; 2,3,4 → succeeded
# 4. SELECT last_succeeded_prompt_index, resume_from_index, resume_session_id FROM runs WHERE id=...
#    Esperado: last_succeeded=4, otros dos NULL
```

## Restricciones

- **NO** cambiar el orden de prompts (`sortedPrompts` queda igual). Solo SKIP basado en índice.
- **NO** "resumir" un prompt parcialmente ejecutado — los skipped son completamente saltados, los demás corren entero. Mid-prompt resume requiere state que no tenemos.
- **NO** levantar el lock del run mientras se hacen los skips — todos los inserts deben ser parte del mismo run "owned" por el worker.
- **NO** olvidarse de limpiar `resume_from_index` al final — si queda seteado, el próximo retry vuelve a saltar y nunca corre nada.
- **NO** registrar prompts skipped como "failed" — usar `status='skipped'` para no contaminar métricas.

## Commit

```
feat(orchestrator): resume runs from last_succeeded_prompt_index

- skip prompts before run.resume_from_index (recorded as 'skipped' in DB)
- pass run.resume_session_id as --resume to first non-skipped prompt
- update runs.last_succeeded_prompt_index after each successful prompt
- clear resume_from_index/resume_session_id at end of run
- 6 new orchestrator tests covering skip, session continuity, index tracking
```

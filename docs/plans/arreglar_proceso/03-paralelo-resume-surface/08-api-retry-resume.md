# Prompt 08 — API: endpoint /retry acepta `from=resume` o `from=start`

## Objetivo
Hoy `POST /api/runs/:id/retry` (en `route.ts`) crea un run nuevo desde el prompt 0. Vamos a:

1. Aceptar query/body param `from`: `"resume"` (default) o `"start"`.
2. Si `from=resume` y el run previo tiene `last_succeeded_prompt_index != null`, pasar a `enqueue_run` el `resume_from_index = last_succeeded_prompt_index + 1` y el `resume_session_id` del último prompt exitoso.
3. Si `from=start`, comportamiento actual (todo desde cero).
4. Si `last_succeeded_prompt_index == null`, ignorar `from=resume` y arrancar desde cero (no hay nada que resumir).
5. Devolver en el response el `resumeFromIndex` y un `mode: "resume" | "start"` para que el UI lo muestre.

> **Pre-requisitos:** prompt 06 (migration con columnas + RPC extendida). Independiente del 07 funcionalmente (la API solo escribe; el orchestrator lee — ambos se conectan via DB).

## Contexto a leer ANTES de tocar

1. `apps/web/app/api/runs/[id]/retry/route.ts` (52 líneas, completo). Ver el flujo actual.
2. `apps/web/lib/api/index.ts` (o donde están `defineRoute`, `respond`, `respondError`) — convenciones de validación de inputs.
3. `apps/web/lib/api/run-utils.ts` — `assertRunOwned`, `emitRunEvent`.
4. `apps/web/AGENTS.md` — recordatorio: este Next.js tiene breaking changes; verificar conventions ahí.
5. `node_modules/next/dist/docs/` (los relevantes para route handlers + searchParams en App Router).
6. La definición actual de `enqueue_run` RPC (después del prompt 06 acepta `p_resume_from_index` y `p_resume_session_id`).

## Cambios concretos

### A. Schema de validación del body/query

Agregar al inicio del archivo (o donde el proyecto declare schemas):

```typescript
import { z } from "zod";

const RetryQuerySchema = z.object({
  from: z.enum(["resume", "start"]).default("resume"),
});

type RetryQuery = z.infer<typeof RetryQuerySchema>;
```

(Si el proyecto usa otro validator que zod, adaptar — leer `lib/api` primero.)

### B. Modificar el handler

```typescript
export const POST = defineRoute<undefined, RetryQuery, Params>(
  {
    rateLimit: "mutation",
    querySchema: RetryQuerySchema,
  },
  async ({ user, traceId, params, query }) => {
    const owned = await assertRunOwned(user.db, params.id, user.userId);
    if (owned === null) return respondError("not_found", "Run not found", { traceId });

    if (!["failed", "cancelled"].includes(owned.status)) {
      return respondError("conflict", `cannot retry a run in status '${owned.status}'`, {
        traceId,
        details: { currentStatus: owned.status },
      });
    }

    // Determine resume params
    let resumeFromIndex: number | null = null;
    let resumeSessionId: string | null = null;
    let mode: "resume" | "start" = "start";

    if (query.from === "resume" && owned.last_succeeded_prompt_index !== null) {
      resumeFromIndex = owned.last_succeeded_prompt_index + 1;

      // Get the session_id of the last succeeded prompt for --resume continuity
      const { data: lastOk } = await user.db
        .from("prompt_executions")
        .select("claude_session_id")
        .eq("run_id", owned.id)
        .eq("prompt_index", owned.last_succeeded_prompt_index)
        .eq("status", "succeeded")
        .order("attempt", { ascending: false })
        .limit(1)
        .maybeSingle();

      resumeSessionId = lastOk?.claude_session_id ?? null;
      mode = "resume";
    }

    const { data: newRunId, error: rpcErr } = await user.db.rpc("enqueue_run", {
      p_plan_id: owned.plan_id,
      p_user_id: user.userId,
      p_working_dir: owned.working_dir,
      p_triggered_by: "retry",
      p_resume_from_index: resumeFromIndex,
      p_resume_session_id: resumeSessionId,
    });

    if (rpcErr !== null || typeof newRunId !== "string") {
      return respondError("internal", "Failed to enqueue retry", {
        traceId,
        details: rpcErr ? { code: rpcErr.code } : undefined,
      });
    }

    await emitRunEvent(user.db, newRunId, "user.retry", {
      previousRunId: owned.id,
      actor: user.userId,
      mode,
      resumeFromIndex,
    });

    const { data: run } = await user.db
      .from("runs")
      .select("*")
      .eq("id", newRunId)
      .maybeSingle();

    return respond(
      {
        ...(run ?? { id: newRunId }),
        _meta: { mode, resumeFromIndex },
      },
      { status: 201, traceId },
    );
  },
);
```

### C. Si `defineRoute` no soporta `querySchema`

Verificar primero. Si NO lo soporta, parsear manual:

```typescript
const url = new URL(request.url);
const fromRaw = url.searchParams.get("from");
const from: "resume" | "start" = fromRaw === "start" ? "start" : "resume";
```

(Este fallback va si la abstracción no permite query schemas.)

## Tests requeridos

Crear/extender `apps/web/app/api/runs/[id]/retry/__tests__/route.test.ts`:

1. **Test "POST sin query usa from=resume por default"**: run previo failed con `last_succeeded_prompt_index=3`. POST sin params. Verificar mock de `enqueue_run` llamado con `p_resume_from_index=4`, `p_resume_session_id=<expected>`.
2. **Test "POST ?from=start ignora last_succeeded"**: mismo run. POST con `?from=start`. Mock llamado con `p_resume_from_index=null`.
3. **Test "POST ?from=resume con last_succeeded=null arranca de cero"**: run con `last_succeeded_prompt_index: null`. Mock llamado con `p_resume_from_index=null`. Response `_meta.mode = "start"`.
4. **Test "responde 409 si status no es failed/cancelled"**: run en `status='running'`. Esperar 409.
5. **Test "evento user.retry incluye mode + resumeFromIndex"**: capturar el `emitRunEvent` mock. Verificar payload.
6. **Test "POST ?from=invalid retorna 400"**: validation error.

## Criterios de aceptación

```bash
pnpm --filter @conductor/web test retry
# 6 tests en verde

pnpm --filter @conductor/web test
# nada roto

# Verificación manual con curl (worker apagado, solo API):
curl -X POST http://localhost:3000/api/runs/<failed-run-id>/retry?from=resume \
  -H "Authorization: Bearer <token>"
# Esperado: 201 + body con _meta.mode="resume", _meta.resumeFromIndex=N+1

# En DB:
# SELECT id, resume_from_index, resume_session_id FROM runs WHERE id=<new-run-id>
# debe mostrar valores no-null si el run previo tenía last_succeeded.
```

## Restricciones

- **NO** mutar el run anterior. Sigue siendo audit record.
- **NO** intentar combinar plans diferentes. El retry usa el MISMO `plan_id`. Si el plan cambió desde que falló el run anterior, los índices pueden no corresponder — eso es responsabilidad del usuario; documentar en el README del feature.
- **NO** retornar el `resume_session_id` en el response (es info sensible que apunta a session de Claude del usuario).
- **NO** validar que el `resumeFromIndex` esté dentro del rango del plan — el orchestrator se encarga (si índice > totalPrompts, no corre nada y termina, comportamiento aceptable).
- **NO** romper consumers existentes que llaman `POST /retry` sin params: con default `from=resume`, el comportamiento cambia de "todo desde cero" a "resume". Eso ES el feature; documentarlo y avisar al usuario en este commit.

## Commit

```
feat(api): /retry supports `from=resume` (default) and `from=start`

- when from=resume + previous run has last_succeeded_prompt_index, the new run
  is enqueued with resume_from_index = last_succeeded + 1 and the session_id
  of the last successful prompt for --resume continuity
- from=start preserves the old behavior (full re-execution from prompt 0)
- response includes _meta.mode and _meta.resumeFromIndex for UI display
- 6 route tests covering happy paths + edge cases
- BREAKING UX: default behavior changed; users must pass ?from=start to opt-out
```

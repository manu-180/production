# Prompt 04 — Retries default ≥ 2 con backoff exponencial + jitter

## Objetivo
Hoy en `orchestrator.ts:606` el cálculo es `maxAttempts = (prompt.frontmatter.retries ?? 0) + 1` — si el frontmatter no especifica `retries`, el prompt corre **una sola vez** sin reintentos automáticos. Esto contradice la existencia de `DEFAULT_RETRY_POLICY.maxAttempts = 3` en `recovery/retry-policy.ts`. Vamos a unificar:

- Default `retries = 2` (3 intentos totales) cuando el frontmatter no lo especifica.
- Backoff ya existe (`nextDelay` con `exponential-jitter`); solo verificar que esté siendo usado.
- Errores transient/timeout/idle_stall → retry. Auth/config → no retry (ya está bien clasificado tras prompt 05; este prompt asume que prompt 05 corre DESPUÉS).

> **Pre-requisito:** prompt 06 (migration) NO es necesario para este; pero los prompts 01 (logging) y 02 (idle timeout) sí ayudan al observar el comportamiento.

## Contexto a leer ANTES de tocar

1. `packages/core/src/orchestrator/orchestrator.ts` líneas 600-910 — el bucle de attempts. Especial atención a las líneas 606, 619, 627, 880, 899.
2. `packages/core/src/recovery/retry-policy.ts` (completo) — `DEFAULT_RETRY_POLICY`, `nextDelay`, `BackoffStrategy`.
3. `packages/core/src/orchestrator/frontmatter-schema.ts` — schema de frontmatter de prompts (campo `retries`).
4. `packages/core/src/orchestrator/__tests__/orchestrator.test.ts` — patrón de tests existentes para attempts.
5. `packages/core/src/recovery/__tests__/retry-policy.test.ts` — confirmar que tests del policy ya pasan.

## Cambios concretos

### A. Constante global de default

En `packages/core/src/orchestrator/orchestrator.ts`, near top of file:

```typescript
/**
 * Default attempts per prompt when frontmatter doesn't override.
 * 1 inicial + 2 retries = 3 attempts totales (alineado con DEFAULT_RETRY_POLICY).
 */
export const DEFAULT_PROMPT_RETRIES = 2;
```

### B. Cambiar el cálculo de `maxAttempts`

Línea ~606, de:
```typescript
const maxAttempts = (prompt.frontmatter.retries ?? 0) + 1;
```

A:
```typescript
const retries = prompt.frontmatter.retries ?? DEFAULT_PROMPT_RETRIES;
const maxAttempts = Math.max(1, retries + 1);
```

### C. Verificar backoff sigue conectado

Buscar la línea ~899 con `await sleep(nextDelay(...))`. Confirmar que:
- `nextDelay` recibe `DEFAULT_RETRY_POLICY` (o el policy clasificado por error).
- El `attempt` que se le pasa es el siguiente intento (1-based).
- `sleep()` es interrumpible por cancel del run (si el user pausa el run, el sleep debe romperse). Si NO es interrumpible hoy, agregar AbortSignal:

```typescript
async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    }, { once: true });
  });
}
```

Y pasarle el signal del run desde `execution-context`.

### D. Usar `extractRetryAfterMs` para rate-limit

Si `classifyError` retorna `category: "rate_limit"` con `waitMs`, el backoff debe ser `Math.max(nextDelay(...), waitMs)`. Eso ya parece estar en el código — verificar y dejar comentario si no.

### E. Default de frontmatter en `frontmatter-schema.ts`

Si el schema usa `zod`/`valibot`, marcar `retries: z.number().int().min(0).max(10).optional()`. NO setear default acá (el orchestrator ya maneja undefined → 2).

## Tests requeridos

En `packages/core/src/orchestrator/__tests__/orchestrator.test.ts`:

1. **Test "prompt sin frontmatter.retries usa DEFAULT_PROMPT_RETRIES"**: mockear executor que falla con `ExecutorErrorCode.TIMEOUT` siempre. Verificar que el orchestrator hace exactamente 3 attempts (1 + 2 retries) antes de marcar el prompt como failed.
2. **Test "frontmatter.retries=0 hace exactamente 1 attempt"**: mismo executor, frontmatter `{retries: 0}`. Esperar 1 attempt.
3. **Test "frontmatter.retries=5 hace 6 attempts"**: esperar 6.
4. **Test "AUTH_INVALID no se reintenta aunque retries=10"**: mockear executor con `ExecutorErrorCode.AUTH_INVALID`. Esperar 1 attempt y `requiresHumanAction`.
5. **Test "RATE_LIMITED espera waitMs (extractRetryAfterMs) si > backoff"**: mockear executor que tira `RATE_LIMITED` con `retryAfter: 5` (=5000ms). El backoff inicial sería ~1000ms; verificar que el sleep pre-retry es ≥5000ms. Usar fake timers + spy en sleep.
6. **Test "backoff es exponencial-jitter"**: 3 intentos con TIMEOUT, capturar los delays. Cada uno debe ser ≤ `min(initialDelayMs * 2^(attempt-1), maxDelayMs)`.

## Criterios de aceptación

```bash
pnpm --filter @conductor/core test orchestrator
# tests existentes + 6 nuevos en verde

pnpm --filter @conductor/core test retry-policy
# tests existentes en verde (no deberían cambiar)

pnpm --filter @conductor/core test
# global: nada roto

# Verificación de comportamiento:
# Crear un prompt con `command: "false"` (siempre exit 1) y SIN `retries` en frontmatter.
# Correr el plan. En logs debe verse:
#   orchestrator.attempt.start attempt:1
#   orchestrator.attempt.end attempt:1 willRetry:true
#   orchestrator.attempt.start attempt:2
#   ...hasta attempt:3...
#   orchestrator.attempt.end attempt:3 willRetry:false
```

## Restricciones

- **NO** cambiar `DEFAULT_RETRY_POLICY` en `retry-policy.ts` (ya está bien).
- **NO** cambiar la API pública de `nextDelay`. Solo el caller.
- **NO** subir el default arriba de 2 — más retries = más costo. 2 es el balance correcto.
- **NO** tocar la clasificación de errores acá — eso es prompt 05.
- **NO** agregar feature flag para esto. Comportamiento default cambia para todos los users.

## Commit

```
feat(orchestrator): default 2 retries per prompt with exponential backoff

- new DEFAULT_PROMPT_RETRIES=2 constant
- prompts without explicit frontmatter.retries now run up to 3 attempts
- rate-limit hint (extractRetryAfterMs) overrides backoff when longer
- sleep is now AbortSignal-aware to honor run cancellation mid-backoff
- 6 new orchestrator tests covering default + override + auth + rate-limit
```

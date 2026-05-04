# Prompt 05 — Clasificador de errores: agregar IDLE_STALL + reducir UNKNOWN

## Objetivo
El clasificador `recovery/error-classifier.ts` ya maneja la mayoría de códigos. Pero (a) no contempla el nuevo `IDLE_STALL` agregado en prompt 02, (b) cuando `decision.classified === null` el orchestrator escribe `error_code = "UNKNOWN"` ocultando información útil, y (c) los tests existentes no cubren la rama `default`. Vamos a:

1. Mapear `IDLE_STALL → transient, retryable, waitMs base 5s` (más corto que rate-limit porque no es upstream-imposed).
2. Hacer que el orchestrator preserve el `code` original cuando classifier no sabe (e.g. `ERR_SPAWN_EINVAL`), en vez de aplastar a `UNKNOWN`.
3. Tests que cubran cada `case` del switch + el `default`.

> **Pre-requisitos:** prompts 02 (IDLE_STALL existe en `ExecutorErrorCode`) y 04 (retries default ≥ 2) ya merged.

## Contexto a leer ANTES de tocar

1. `packages/core/src/recovery/error-classifier.ts` (140 líneas, completo). Ver el switch en `classifyError`.
2. `packages/core/src/executor/errors.ts` — lista actualizada de `ExecutorErrorCode`. Confirmar que `IDLE_STALL` está (lo agregó el prompt 02).
3. `packages/core/src/orchestrator/orchestrator.ts` líneas 860-880 — donde se construye el `error_code` a persistir en DB. Ver cómo decide entre `decision.classified?.category.toUpperCase()` y `"UNKNOWN"`.
4. `packages/core/src/recovery/__tests__/error-classifier.test.ts` — convenciones.

## Cambios concretos

### A. Agregar case para IDLE_STALL en `classifyError`

```typescript
case ExecutorErrorCode.IDLE_STALL:
  return {
    category: "transient",
    retryable: true,
    waitMs: 5_000, // breve — el problema es local, no upstream
  };
```

Insertarlo en el switch entre TIMEOUT y PARSE_ERROR para mantener orden lógico (transient errors agrupados).

### B. No aplastar códigos desconocidos a "UNKNOWN" en orchestrator

En `orchestrator.ts`, donde se construye el error_code a persistir (línea ~874), hoy es algo como:

```typescript
const errCode = isGuardianLoop
  ? "GUARDIAN_LOOP"
  : decision.classified?.category.toUpperCase() ?? "UNKNOWN";
```

Cambiar a:

```typescript
function buildErrorCode(args: {
  isGuardianLoop: boolean;
  classified: ClassifiedError | null;
  executorErrCode: ExecutorErrorCode | string | null;
}): string {
  if (args.isGuardianLoop) return "GUARDIAN_LOOP";
  if (args.classified !== null) {
    // Categoría conocida: usarla en uppercase (e.g. "TRANSIENT", "AUTH")
    return args.classified.category.toUpperCase();
  }
  // Sin clasificación: preservar el code crudo para no perder info
  if (typeof args.executorErrCode === "string" && args.executorErrCode.length > 0) {
    return args.executorErrCode;
  }
  return "UNKNOWN";
}
```

Y reemplazar el call. El raw `executorErrCode` viene del `ExecutorError.code` capturado en el catch.

### C. Categoría más granular en classified

Agregar una nueva categoría `"idle"` para que sea distinguible del bucket `"transient"`:

```typescript
export type ErrorCategory =
  | "transient"
  | "idle"        // NEW
  | "rate_limit"
  | "auth"
  | "config"
  | "system"
  | "unknown";
```

Y cambiar el case de IDLE_STALL a:

```typescript
case ExecutorErrorCode.IDLE_STALL:
  return { category: "idle", retryable: true, waitMs: 5_000 };
```

Esto da granularidad para dashboards/alerts: "idle stalls" se distinguen de "transient" (timeout wall-clock, spawn errors).

### D. Reducir el bucket `default: unknown, retryable: false`

Hoy el `default` del switch retorna `{category: "unknown", retryable: false}` — esto **bloquea** retry para cualquier code futuro. Cambiar a:

```typescript
default:
  // Code desconocido (puede ser uno nuevo aún no mapeado). Permitir retry
  // best-effort pero loggear para que se actualice el classifier.
  return { category: "unknown", retryable: true };
```

Y agregar al inicio de `classifyError`:

```typescript
import { logger } from "../logger.js";
// ...dentro del default:
logger.warn(
  { code: err.code, message: err.message },
  "error-classifier.unknown_code",
);
return { category: "unknown", retryable: true };
```

(Esto unifica con el `case ExecutorErrorCode.UNKNOWN` que ya retorna `retryable: true`.)

## Tests requeridos

En `packages/core/src/recovery/__tests__/error-classifier.test.ts`, agregar:

1. **Test "IDLE_STALL → idle, retryable, waitMs=5000"**: construir `ExecutorError(IDLE_STALL, ...)`, esperar exactamente `{category: "idle", retryable: true, waitMs: 5000}`.
2. **Test "default branch → unknown, retryable=true (no más false)"**: pasar un error con `code: "FOO_NOT_REAL" as ExecutorErrorCode`. Esperar `retryable: true`.
3. **Test "default branch loggea unknown_code con warn"**: capturar logs Pino. Verificar el warn.
4. **Test snapshot "todos los códigos cubiertos"**: iterar `Object.values(ExecutorErrorCode)`, llamar `classifyError` para cada uno, snapshot del resultado. Esto garantiza que agregar un código nuevo en futuro rompe el test si no se cubre.

En `packages/core/src/orchestrator/__tests__/orchestrator.test.ts` (modificar/agregar):

1. **Test "error sin clasificación preserva el code crudo en error_code"**: mockear executor que tira `ExecutorError("CUSTOM_FAIL_1234", ...)`. Verificar que la fila persistida en DB tiene `error_code = "CUSTOM_FAIL_1234"` (NO "UNKNOWN").
2. **Test "error idle persiste error_code='IDLE'"**: executor con IDLE_STALL → `error_code = "IDLE"`.

## Criterios de aceptación

```bash
pnpm --filter @conductor/core test error-classifier
# tests existentes + 4 nuevos en verde

pnpm --filter @conductor/core test orchestrator
# tests del prompt 04 + 2 nuevos de este, todos en verde

pnpm --filter @conductor/core test
# global verde

# Verificación dashboard:
# Después de un timeout idle, en `prompt_executions.error_code` debe verse "IDLE"
# (no "UNKNOWN"). Para un EINVAL de spawn debe verse "ERR_SPAWN_EINVAL" o el code crudo.
```

## Restricciones

- **NO** cambiar la signature de `classifyError` ni de `ClassifiedError` salvo agregar el campo opcional/categoría — código que ya consume estos no debe romper.
- **NO** quitar el case `UNKNOWN` del switch — distinto de `default`. UNKNOWN explícito sigue siendo retryable.
- **NO** intentar parsear `err.message` para "adivinar" categoría. Solo basarse en `err.code`.
- **NO** alterar el comportamiento de `extractRetryAfterMs` — está bien y testeado.
- **NO** crear category nuevas más allá de `"idle"`. Mantener el set chico.

## Commit

```
feat(recovery): classify IDLE_STALL and preserve raw error codes

- new ErrorCategory "idle" for IDLE_STALL (5s wait, retryable)
- orchestrator preserves ExecutorError.code in DB when classifier returns null
  (no more silent "UNKNOWN" hiding ERR_SPAWN_EINVAL etc.)
- default switch branch now retryable=true (was false) + warn log
- snapshot test ensures all ExecutorErrorCode values are covered
```

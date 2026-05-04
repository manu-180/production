# Prompt 01 — Baseline tests + logging estructurado de progreso

## Objetivo
Antes de cambiar nada, dejar visibilidad: snapshot del estado actual de tests + logs estructurados que muestren `bytes recibidos` y `tiempo desde último token` para cada proceso Claude. Sin esto, los próximos fixes son a ciegas.

## Contexto a leer ANTES de tocar

1. `packages/core/src/executor/claude-process.ts` (completo, ~426 líneas) — entender el flujo de spawn, stdout/stderr handlers, `streamEnded`, `child.on("exit")`, `child.on("close")`.
2. `packages/core/src/orchestrator/orchestrator.ts` líneas 530-905 — entender el loop `while (attempt <= maxAttempts)` y dónde se loggea hoy cada attempt.
3. `packages/core/src/logger.ts` y `packages/core/src/logger/` — qué API de logging existe (Pino structured). Usá esa, no `console.log`.
4. `packages/core/src/executor/__tests__/` — ver cómo están escritos los tests actuales (Vitest, mocks de spawn).

## Cambios concretos

### A. Snapshot de tests
1. Correr `pnpm test --reporter=json > docs/plans/arreglar_proceso/_baseline-tests.json` desde la raíz del repo.
2. Si algún test ya está roto antes de tocar nada: STOP, reportar al usuario, no continuar.

### B. Logging en `claude-process.ts`
Agregar al cuerpo del proceso (no en hot path por línea — usar contadores):

- Variable `let bytesReceived = 0;` y `let lastByteAt = Date.now();`
- En el handler de `stdout` (donde llega cada chunk): incrementar `bytesReceived += chunk.length` y actualizar `lastByteAt = Date.now()`
- En `child.on("exit")` y `child.on("error")`: loggear con structured fields:
  ```
  logger.info({ pid, bytesReceived, msSinceLastByte: Date.now() - lastByteAt, exitCode, signal }, "claude.process.exit")
  ```
- Si `bytesReceived === 0` al exit, loggear con `level=warn` y mensaje `"claude.process.no_output"`.

### C. Heartbeat de progreso (interval, NO por chunk)
En `claude-process.ts`, dentro del `start()` o equivalente:
- `setInterval(() => logger.debug({ pid, bytesReceived, msSinceLastByte: Date.now() - lastByteAt }, "claude.process.progress"), 30_000)`
- Limpiar el interval en `cleanup()` (`clearInterval` cuando el proceso termina o se mata).

### D. Logging por intento en orchestrator
En `orchestrator.ts`, en el inicio de cada iteración del loop de attempts (~línea 611):
- `logger.info({ runId, promptIndex, promptName, attempt, maxAttempts }, "orchestrator.attempt.start")`

Y al terminar (éxito o fallo):
- `logger.info({ runId, promptIndex, attempt, durationMs, status, errorCode, willRetry }, "orchestrator.attempt.end")`

## Tests requeridos

Agregar en `packages/core/src/executor/__tests__/claude-process.test.ts` (o nuevo archivo):

1. **Test "no output ⇒ warn log"**: mockear spawn para devolver proceso que cierra sin emitir stdout. Capturar logs (Pino destination injectable). Esperar 1 log `level=warn`, `event="claude.process.no_output"`.
2. **Test "bytesReceived contado correctamente"**: mockear spawn para emitir 3 chunks (`"a", "bc", "def"` = 6 bytes). Verificar que el log de exit reporta `bytesReceived: 6`.

NO escribir tests que toquen el filesystem real ni que llamen a Claude real.

## Criterios de aceptación

```bash
pnpm --filter @conductor/core test claude-process
# debe pasar TODO; output debe incluir los 2 nuevos tests en verde

pnpm --filter @conductor/core test
# debe pasar; ningún test existente roto
```

Adicional manual:
- `pnpm --filter @conductor/worker dev` y arrancar un run pequeño. En los logs debe verse:
  - `orchestrator.attempt.start` con runId+promptIndex
  - `claude.process.progress` cada ~30s mientras corre
  - `claude.process.exit` con `bytesReceived` y `msSinceLastByte`

## Restricciones

- **NO** cambiar la lógica de timeout, retry, ni clasificación de errores. Solo logging.
- **NO** romper la API pública de `ClaudeProcess` (no agregar params requeridos al constructor).
- **NO** loggear el contenido del stdout (solo bytes y timing — el contenido ya se persiste en `prompt_executions.output_log`).
- **NO** usar `console.log/warn/error` — usar el logger Pino existente.
- **NO** mover archivos ni renombrar identificadores existentes.

## Commit

```
feat(executor): add structured progress logging for claude processes

- log bytes_received and ms_since_last_byte on exit
- warn when process exits with zero output
- 30s progress heartbeat in debug level
- per-attempt structured logs in orchestrator
- baseline test snapshot saved to docs/plans/arreglar_proceso/_baseline-tests.json
```

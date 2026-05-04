# Prompt 06 — Migration Supabase: campos para resume desde último OK

## Objetivo
Agregar el state mínimo en DB para que un retry pueda **reanudar** un run desde el prompt siguiente al último exitoso, en vez de re-ejecutar el plan completo desde el prompt 1.

## Contexto a leer ANTES de tocar

1. `supabase/migrations/` (listar contenido) — ver el formato de migration files (`<timestamp>_<name>.sql`), convenciones (RLS, comments, etc).
2. La migration más reciente para tomar el prefijo de timestamp como referencia.
3. `packages/db/` — ver dónde están los tipos generados de Supabase (`database.types.ts` o similar) y cómo se regeneran (`pnpm supabase gen types typescript`).
4. La definición actual de la tabla `runs` (buscar la migration que la crea, probablemente en las primeras `00*` o `01*`).
5. La definición actual de `prompt_executions` (mismo proceso).
6. RPC `enqueue_run` (buscar `CREATE OR REPLACE FUNCTION enqueue_run` en migrations) — vamos a necesitar una variante o extender la existente.

## Cambios concretos

### Migration nueva: `<NEW_TIMESTAMP>_runs_resume_state.sql`

Contenido (adaptar a las convenciones existentes; usar `IF NOT EXISTS`):

```sql
-- runs.last_succeeded_prompt_index: índice (0-based) del último prompt completado con success.
-- NULL = ningún prompt OK aún.
ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS last_succeeded_prompt_index INTEGER;

-- runs.resume_from_index: si != NULL, el orchestrator arranca desde ese índice
-- en vez de prompt 0. Lo setea el endpoint de retry; lo limpia el orchestrator
-- cuando completa un run.
ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS resume_from_index INTEGER;

-- runs.resume_session_id: el claude_session_id del último prompt exitoso, para
-- pasar a `--resume` en el primer prompt del retry.
ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS resume_session_id TEXT;

-- Índice útil para queries del dashboard "runs reanudables"
CREATE INDEX IF NOT EXISTS runs_status_resume_idx
  ON runs (status, resume_from_index)
  WHERE resume_from_index IS NOT NULL;

COMMENT ON COLUMN runs.last_succeeded_prompt_index IS
  'Índice 0-based del último prompt completado exitosamente. NULL si ninguno.';
COMMENT ON COLUMN runs.resume_from_index IS
  'Si != NULL, orchestrator arranca desde este índice (resume desde último OK).';
COMMENT ON COLUMN runs.resume_session_id IS
  'claude_session_id del último prompt exitoso del run anterior, para --resume.';
```

### Backfill seguro
NO hacer backfill desde otras tablas en esta migration. Las columnas se llenan en runs futuros vía orchestrator (prompt 07) y endpoint retry (prompt 08).

### RPC: extender `enqueue_run` (NUEVA migration en mismo timestamp + 1)

Crear `<NEW_TIMESTAMP+1>_enqueue_run_with_resume.sql` con `CREATE OR REPLACE FUNCTION` que extiende los params:

```sql
CREATE OR REPLACE FUNCTION enqueue_run(
  p_plan_id UUID,
  p_user_id UUID,
  p_working_dir TEXT,
  p_triggered_by TEXT DEFAULT 'manual',
  p_resume_from_index INTEGER DEFAULT NULL,
  p_resume_session_id TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
BEGIN
  INSERT INTO runs (
    plan_id, user_id, working_dir, status, triggered_by,
    resume_from_index, resume_session_id
  ) VALUES (
    p_plan_id, p_user_id, p_working_dir, 'queued', p_triggered_by,
    p_resume_from_index, p_resume_session_id
  )
  RETURNING id INTO v_run_id;

  RETURN v_run_id;
END;
$$;
```

(Adaptar al cuerpo real de `enqueue_run` actual — leer la versión existente primero para no perder lógica de validación, RLS, eventos pinned, etc. Esto es un esquema; respetar lo que ya tiene.)

### Regenerar tipos
```bash
pnpm --filter @conductor/db gen-types
# o el comando equivalente que use el monorepo (revisar package.json de @conductor/db)
```

Verificar que `Database["public"]["Tables"]["runs"]["Row"]` ahora incluya los 3 campos nuevos como `number | null` y `string | null`.

## Tests requeridos

### Test de migration (smoke)
En `supabase/migrations/__tests__/` o donde estén los tests de DB (si existen — sino, sólo verificación manual):

1. Aplicar migration en stack local (`pnpm supabase db reset`).
2. Verificar columnas existen:
   ```bash
   pnpm supabase db --workdir . exec "
     SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_name = 'runs'
     AND column_name IN ('last_succeeded_prompt_index', 'resume_from_index', 'resume_session_id')
   "
   ```
   Esperado: 3 filas, todas `is_nullable = YES`.

3. Verificar RPC acepta nuevos args:
   ```sql
   SELECT enqueue_run(
     '<plan-uuid>'::uuid,
     '<user-uuid>'::uuid,
     '/tmp/test',
     'retry',
     5,
     'sess_abc'
   );
   ```
   Debe retornar un UUID. Insertar `SELECT resume_from_index, resume_session_id FROM runs WHERE id = <returned>` debe dar `(5, 'sess_abc')`.

## Criterios de aceptación

```bash
# 1. Migrations aplican sin error
pnpm supabase db reset
# salida: "Finished supabase db reset on local database."

# 2. Tipos regenerados
pnpm --filter @conductor/db gen-types
# y verificar que database.types.ts contenga los 3 campos nuevos

# 3. Tests no rotos
pnpm test
# todos los tests deben seguir pasando (los tipos cambiaron; código que usa runs.* sigue compilando)
```

## Restricciones

- **NO** modificar columnas existentes de `runs` o `prompt_executions`.
- **NO** crear nuevas tablas. Solo `ALTER TABLE ADD COLUMN` y `CREATE OR REPLACE FUNCTION`.
- **NO** romper RLS. Si `runs` tiene policies, no las toques — los nuevos campos heredan.
- **NO** hacer backfill cargando desde `prompt_executions`. Dejar `NULL`; los runs futuros las llenan.
- **NO** tocar TypeScript del orchestrator/web/worker en este prompt. Solo SQL + tipos generados.

## Commit

```
feat(db): add resume state columns to runs + extend enqueue_run RPC

- runs.last_succeeded_prompt_index: tracks last OK prompt
- runs.resume_from_index: tells orchestrator to skip prompts before this
- runs.resume_session_id: --resume hint for first prompt of retry
- enqueue_run() accepts optional resume params (default NULL = fresh run)
- regenerated database.types.ts
```

# Prompt 12 — E2E test: failure mid-plan + resume desde último OK

## Objetivo
Validar end-to-end que toda la cadena de fixes funciona: un plan de 5 prompts donde el #3 falla, el usuario clickea "Reintentar" en el UI eligiendo "Continuar", y los prompts 1-2 NO se re-ejecutan (verificable en DB), el #3 se reintenta y los #4-5 corren después.

> **Pre-requisito:** TODOS los prompts anteriores (01-11) merged. Este test valida la integración total.

## Contexto a leer ANTES de tocar

1. `e2e/` (carpeta raíz) — listar contenido. Ver patrón de tests existentes (Playwright).
2. `playwright.config.ts` — configuración (storageState, baseURL, projects).
3. Cualquier helper en `e2e/helpers/` — auth de prueba, fixtures de plan, cleanup de DB entre tests.
4. `apps/web/AGENTS.md` — convenciones Next del proyecto.
5. Verificar si hay un `e2e/fixtures/` con planes de prueba YAML.

## Cambios concretos

### A. Plan de prueba determinístico

Crear `e2e/fixtures/plans/resume-test-plan.yml` (5 prompts, cada uno auto-contenido y rápido):

```yaml
name: resume-test-plan
description: Plan de 5 prompts para validar resume. Prompt 3 está diseñado para fallar.
prompts:
  - name: prompt-1-create-file
    promptText: |
      Crea un archivo llamado step-1.txt con el contenido "ok-1". Reportá éxito.
    retries: 0
    idleTimeoutMs: 60000

  - name: prompt-2-append
    promptText: |
      Apendizá la línea "ok-2" al archivo step-1.txt. Reportá éxito.
    retries: 0
    idleTimeoutMs: 60000

  - name: prompt-3-injected-failure
    promptText: |
      Ejecutá el comando `__FORCE_FAILURE__`. Si ese comando no existe, fallá.
    retries: 0
    idleTimeoutMs: 60000

  - name: prompt-4-after-failure
    promptText: |
      Apendizá la línea "ok-4" al archivo step-1.txt. Reportá éxito.
    retries: 0
    idleTimeoutMs: 60000

  - name: prompt-5-final
    promptText: |
      Apendizá la línea "ok-5" al archivo step-1.txt. Reportá éxito.
    retries: 0
    idleTimeoutMs: 60000
```

**Importante:** este test NO debe llamar a la API real de Claude — usar **mock executor** o el test real con un prompt mínimo. Si el proyecto ya tiene mock para E2E, usar ese. Si no, usar prompts cortos contra Claude real (más caro, pero confiable). Documentar la decisión.

### B. Test E2E: `e2e/tests/resume-from-failure.spec.ts`

```typescript
import { test, expect } from "@playwright/test";
import { createTestUser, loginAs, cleanupTestRuns, getDbClient } from "../helpers";
import { uploadPlan } from "../helpers/plans";
import path from "node:path";

test.describe("Resume from last successful prompt", () => {
  test.beforeEach(async () => {
    await cleanupTestRuns();
  });

  test("retry with from=resume skips already-succeeded prompts", async ({ page }) => {
    // 1. Setup: user + plan
    const user = await createTestUser();
    await loginAs(page, user);

    const planId = await uploadPlan(
      user,
      path.resolve(__dirname, "../fixtures/plans/resume-test-plan.yml"),
    );

    // 2. Lanzar el plan
    await page.goto("/dashboard/plans");
    await page.getByText("resume-test-plan").click();
    await page.getByRole("button", { name: /Lanzar/i }).click();

    // 3. Esperar a que termine en failure (prompt 3 falla)
    //    Usar polling de la DB en vez de UI para robustez
    const db = getDbClient();
    const runId = await waitForRunStatus(db, user.id, planId, "failed", 120_000);

    // 4. Verificar estado en DB: prompts 0,1 OK; 2 failed; 3,4 no ejecutados
    const { data: execsBefore } = await db
      .from("prompt_executions")
      .select("prompt_index, status")
      .eq("run_id", runId)
      .order("prompt_index");

    expect(execsBefore).toHaveLength(3); // 0, 1, 2
    expect(execsBefore?.[0]).toMatchObject({ prompt_index: 0, status: "succeeded" });
    expect(execsBefore?.[1]).toMatchObject({ prompt_index: 1, status: "succeeded" });
    expect(execsBefore?.[2]).toMatchObject({ prompt_index: 2, status: "failed" });

    const { data: runBefore } = await db
      .from("runs")
      .select("last_succeeded_prompt_index")
      .eq("id", runId)
      .single();
    expect(runBefore?.last_succeeded_prompt_index).toBe(1);

    // 5. UI: ir al detalle del run, clickear "Reintentar"
    await page.goto(`/dashboard/runs/${runId}`);
    await page.getByRole("button", { name: "Reintentar" }).click();

    // Modal: verificar texto "2 de 5 prompts"
    await expect(page.getByText("2 de 5 prompts")).toBeVisible();

    // Default seleccionado: "Continuar desde el prompt 3"
    const resumeRadio = page.getByLabel(/Continuar desde el prompt 3/i);
    await expect(resumeRadio).toBeChecked();

    // Click Reintentar (commit)
    await page.getByRole("button", { name: "Reintentar" }).last().click();

    // 6. Esperar redirect al nuevo run
    await page.waitForURL(/\/dashboard\/runs\/[a-f0-9-]+/);
    const newRunId = page.url().split("/").pop()!;
    expect(newRunId).not.toBe(runId);

    // 7. Verificar en DB: nuevo run con resume_from_index=2
    const { data: newRun } = await db
      .from("runs")
      .select("resume_from_index, resume_session_id")
      .eq("id", newRunId)
      .single();
    expect(newRun?.resume_from_index).toBe(2);

    // 8. Esperar a que termine (puede ser failed otra vez por prompt 3 — está OK,
    //    lo que validamos es que prompts 0 y 1 NO se re-ejecutaron)
    await waitForRunStatus(db, user.id, planId, /failed|succeeded/, 120_000, newRunId);

    const { data: execsAfter } = await db
      .from("prompt_executions")
      .select("prompt_index, status")
      .eq("run_id", newRunId)
      .order("prompt_index, attempt");

    // Prompts 0 y 1 deben aparecer como 'skipped' (no re-ejecutados)
    const skipped = execsAfter?.filter((e) => e.status === "skipped") ?? [];
    expect(skipped.map((e) => e.prompt_index).sort()).toEqual([0, 1]);

    // Prompt 2 debe haberse intentado (succeeded o failed dependiendo del mock)
    const prompt2Execs = execsAfter?.filter((e) => e.prompt_index === 2) ?? [];
    expect(prompt2Execs.length).toBeGreaterThan(0);
  });

  test("retry with from=start re-runs all prompts", async ({ page }) => {
    // ...similar setup, pero en el modal click radio "Reiniciar plan completo"
    // Verificar que execsAfter NO tiene status='skipped' y SÍ vuelve a ejecutar
    // los prompts 0,1.
    // (test más corto, foco en diferenciar de "resume")
    test.skip(); // placeholder — implementar si tiempo permite
  });
});

async function waitForRunStatus(
  db: ReturnType<typeof getDbClient>,
  userId: string,
  planId: string,
  expectedStatus: string | RegExp,
  timeoutMs: number,
  runId?: string,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let q = db
      .from("runs")
      .select("id, status")
      .eq("user_id", userId)
      .eq("plan_id", planId)
      .order("created_at", { ascending: false });
    if (runId) q = q.eq("id", runId);
    const { data } = await q.limit(1).maybeSingle();
    if (data) {
      const status = data.status;
      if (
        (typeof expectedStatus === "string" && status === expectedStatus) ||
        (expectedStatus instanceof RegExp && expectedStatus.test(status))
      ) {
        return data.id;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Run did not reach status ${expectedStatus} within ${timeoutMs}ms`);
}
```

### C. Helper de cleanup

Si `cleanupTestRuns` no existe, crear en `e2e/helpers/cleanup.ts`:

```typescript
export async function cleanupTestRuns(): Promise<void> {
  const db = getDbClient();
  // Borrar runs y prompt_executions de usuarios de test (asumiendo prefix)
  const { data: testUsers } = await db
    .from("auth.users")
    .select("id")
    .like("email", "e2e-test-%");
  if (!testUsers?.length) return;
  const ids = testUsers.map((u) => u.id);
  await db.from("prompt_executions").delete().in("user_id", ids);
  await db.from("runs").delete().in("user_id", ids);
}
```

## Criterios de aceptación

```bash
# Pre-requisito: stack local up
pnpm supabase start
pnpm --filter @conductor/web build
pnpm --filter @conductor/worker build

# Correr los tests E2E
pnpm test:e2e --grep "Resume from last"
# Esperado: 1 test passed (el "skip" del segundo no cuenta como fail)

# Ver el reporte
pnpm playwright show-report
# revisar screenshots/traces si algo falla
```

## Restricciones

- **NO** correr este test contra producción / Supabase remoto. Solo local stack.
- **NO** depender de timing exacto del UI — usar polling de DB para sincronización.
- **NO** dejar runs de test sin limpiar (pueden ensuciar dashboards).
- **NO** asumir que el segundo run termina en `succeeded` — el prompt 3 sigue siendo `__FORCE_FAILURE__`. Lo que validamos es **resume**, no éxito de plan.
- **NO** hardcodear UUIDs ni IDs específicos — todo debe venir del setup.
- **NO** usar Claude API real si hay mock executor disponible — ahorra costo y tiempo.

## Commit

```
test(e2e): validate resume-from-failure end-to-end

- new playwright spec: resume-test-plan.yml + resume-from-failure.spec.ts
- exercises: launch plan → fail at prompt 3 → click Retry (resume) →
  verify prompts 0,1 are 'skipped' in new run, prompt 2 retried
- DB-polling helper for status sync (no UI race conditions)
- cleanup helper to wipe e2e test runs between specs
```

## Resumen de la cadena validada por este test

Este test debe FALLAR si cualquiera de estos prompts no se completó correctamente:

- Prompt 06 (migration con `last_succeeded_prompt_index`, `resume_from_index`)
- Prompt 07 (orchestrator skip + tracking)
- Prompt 08 (API endpoint con `from=`)
- Prompt 09 (UI modal con radio resume/start)
- Prompts 04, 05 (no estrictamente, pero ayudan a que el prompt 3 falle limpio)

Si pasa: la cadena completa de robustez está operativa para el caso real reportado por el usuario (run de 53 prompts que falló en el 17 y al reintentar perdió todo).

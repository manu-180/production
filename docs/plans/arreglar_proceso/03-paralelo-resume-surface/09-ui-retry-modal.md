# Prompt 09 — UI: modal de "Reintentar" con opción Resume vs Start-over

## Objetivo
Hoy el botón "Reintentar" en el dashboard de runs (vista de un run failed) hace POST directo a `/api/runs/:id/retry` sin opciones. Vamos a:

1. Reemplazarlo por un **botón que abre un modal** (shadcn/ui `Dialog`).
2. Modal muestra info del run anterior: cuántos prompts terminaron OK (`last_succeeded_prompt_index + 1` de `totalPrompts`) y cuáles fallaron.
3. Dos botones radio:
   - **"Continuar desde el prompt N+1"** (default, deshabilitado si no hay nada para resumir)
   - **"Reiniciar plan completo"** (siempre disponible)
4. Botón "Reintentar" del modal hace POST con el `from` correspondiente.
5. Después del POST exitoso, redirigir a la vista del nuevo run (`/dashboard/runs/<newId>`).

> **Pre-requisito:** prompt 08 (API ya soporta `?from=`). Independiente del 07/10 funcionalmente.

## Contexto a leer ANTES de tocar

1. Buscar el componente actual del botón "Reintentar":
   ```bash
   grep -rn "Reintentar\|retry" --include="*.tsx" apps/web | head -30
   ```
2. Ver cómo se usa hoy (probablemente en `apps/web/app/dashboard/runs/[id]/...`).
3. `apps/web/components/ui/dialog.tsx` (o donde esté el wrapper de shadcn/ui Dialog).
4. `apps/web/lib/api-client.ts` (o equivalente) — cómo se hacen requests autenticados desde client components.
5. `apps/web/AGENTS.md` — leer las breaking changes de Next.js.
6. Ver dónde se carga la info del run completo en la página (probablemente Server Component que obtiene `runs.*` + `prompt_executions.*`).

## Cambios concretos

### A. Componente nuevo: `apps/web/components/runs/retry-modal.tsx`

```typescript
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

interface RetryModalProps {
  runId: string;
  totalPrompts: number;
  lastSucceededPromptIndex: number | null;
  failedAtIndex: number | null; // primer prompt que falló (puede ser null si fue cancel)
}

export function RetryModal({
  runId,
  totalPrompts,
  lastSucceededPromptIndex,
  failedAtIndex,
}: RetryModalProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const canResume = lastSucceededPromptIndex !== null;
  const resumeFromIndex = canResume ? lastSucceededPromptIndex + 1 : 0;
  const promptsCompleted = canResume ? lastSucceededPromptIndex + 1 : 0;
  const promptsRemaining = totalPrompts - promptsCompleted;

  const [mode, setMode] = useState<"resume" | "start">(canResume ? "resume" : "start");

  async function submit(): Promise<void> {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/retry?from=${mode}`, {
          method: "POST",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error?.message ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        const newRunId = data?.id;
        if (typeof newRunId !== "string") throw new Error("Respuesta sin id de nuevo run");
        router.push(`/dashboard/runs/${newRunId}`);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error desconocido");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default">Reintentar</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reintentar run</DialogTitle>
          <DialogDescription>
            {promptsCompleted} de {totalPrompts} prompts terminaron exitosamente
            {failedAtIndex !== null ? ` (falló en el prompt ${failedAtIndex + 1}).` : "."}
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as "resume" | "start")}
          className="space-y-3"
        >
          <div className="flex items-start space-x-2">
            <RadioGroupItem value="resume" id="resume" disabled={!canResume} />
            <Label htmlFor="resume" className="flex-1 cursor-pointer">
              <div className="font-medium">
                Continuar desde el prompt {resumeFromIndex + 1}
              </div>
              <div className="text-sm text-muted-foreground">
                {canResume
                  ? `Salta los ${promptsCompleted} prompts ya completados. Quedan ${promptsRemaining} por correr.`
                  : "No hay prompts completados — esta opción no está disponible."}
              </div>
            </Label>
          </div>
          <div className="flex items-start space-x-2">
            <RadioGroupItem value="start" id="start" />
            <Label htmlFor="start" className="flex-1 cursor-pointer">
              <div className="font-medium">Reiniciar plan completo</div>
              <div className="text-sm text-muted-foreground">
                Re-ejecuta los {totalPrompts} prompts desde cero.
              </div>
            </Label>
          </div>
        </RadioGroup>

        {error !== null ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Lanzando…" : "Reintentar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### B. Reemplazar el botón existente

Buscar el sitio donde hoy se renderiza `<Button onClick={retryRun}>Reintentar</Button>` o similar (en la página de run detail). Reemplazar por:

```tsx
<RetryModal
  runId={run.id}
  totalPrompts={prompts.length}
  lastSucceededPromptIndex={run.last_succeeded_prompt_index}
  failedAtIndex={firstFailedPromptIndex}
/>
```

Donde `firstFailedPromptIndex` se computa server-side a partir de `prompt_executions` (primer status='failed').

### C. Si no existe `RadioGroup` de shadcn/ui en el proyecto

```bash
# Verificar primero
ls apps/web/components/ui/ | grep -i radio
```

Si no está, instalar vía shadcn-ui MCP o `pnpm dlx shadcn-ui add radio-group` (lo que use el proyecto). Si el proyecto NO usa shadcn-ui en algún componente similar, usar HTML radio inputs estilizados con Tailwind (no introducir dependencia nueva).

## Tests requeridos

Crear `apps/web/components/runs/__tests__/retry-modal.test.tsx`:

Usar Testing Library + Vitest (verificar el setup en otros `*.test.tsx` del proyecto).

1. **Test "muestra cantidad de prompts completados"**: render con `lastSucceededPromptIndex=3`, `totalPrompts=10`. Esperar texto `"4 de 10 prompts"`.
2. **Test "opción resume está disabled si lastSucceededPromptIndex=null"**: render con `null`. El radio "resume" debe tener `disabled`. El default seleccionado debe ser "start".
3. **Test "click en Reintentar hace POST con from=resume"**: mock `fetch`. Click, verificar URL `/api/runs/<id>/retry?from=resume`.
4. **Test "click con mode=start hace POST con from=start"**: cambiar radio, click. Verificar `?from=start`.
5. **Test "error de API muestra mensaje"**: mock fetch que retorna 500 con `{error:{message:"foo"}}`. Esperar texto "foo" visible.
6. **Test "respuesta exitosa redirige a /dashboard/runs/<newId>"**: mock fetch OK con `{id:"new-run"}`. Verificar `router.push` con la URL correcta.

## Criterios de aceptación

```bash
pnpm --filter @conductor/web test retry-modal
# 6 tests verdes

pnpm --filter @conductor/web test
# nada roto

pnpm --filter @conductor/web build
# build limpio (TypeScript + Next sin errors)

# Verificación visual:
# 1. pnpm --filter @conductor/web dev
# 2. Abrir /dashboard/runs/<un-failed-run-id>
# 3. Click "Reintentar" → modal abre
# 4. Verificar texto "X de Y prompts"
# 5. Default seleccionado = "Continuar desde el prompt N+1" (si hay last_succeeded)
# 6. Click "Reintentar" → redirige a nuevo run, en URL nueva
# 7. En DB: SELECT resume_from_index FROM runs WHERE id=<nuevo>; debe ser N+1
```

## Restricciones

- **NO** introducir librerías UI nuevas (Radix, MUI, etc.) — solo shadcn/ui que ya está en el proyecto, o HTML nativo.
- **NO** hacer el modal un Server Component — necesita estado, debe ser `"use client"`.
- **NO** quitar el confirm para "start" — aunque sea el comportamiento previo, ahora hay que clickear conscientemente porque va a re-correr todo.
- **NO** mostrar el `resume_session_id` en el UI (info sensible).
- **NO** auto-seleccionar "start" si "resume" está disponible — siempre default a "resume" cuando es posible (es el comportamiento más útil).

## Commit

```
feat(web): retry modal with resume vs start-over options

- new components/runs/retry-modal.tsx replaces the bare retry button
- shows prompts completed/total + first failed index
- default selects "resume from N+1" when available, otherwise "start over"
- 6 component tests (Testing Library + Vitest) covering all paths
- on success redirects to the newly enqueued run page
```

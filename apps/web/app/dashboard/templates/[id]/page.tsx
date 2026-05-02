import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getTemplateById } from "@/lib/templates";
import type { Plan, Prompt } from "@conductor/db";
import { ArrowLeftIcon } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PromptPreview {
  title: string | null;
  filename: string | null;
  content: string;
  order_index?: number;
}

interface ResolvedTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
  prompts: PromptPreview[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchUserTemplate(planId: string): Promise<(Plan & { prompts: Prompt[] }) | null> {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const cookie = h.get("cookie") ?? "";

  const res = await fetch(`${proto}://${host}/api/plans/${planId}`, {
    cache: "no-store",
    headers: { cookie },
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Plan fetch failed: ${res.status}`);
  return res.json() as Promise<Plan & { prompts: Prompt[] }>;
}

async function resolveTemplate(id: string): Promise<ResolvedTemplate | null> {
  if (UUID_RE.test(id)) {
    // User plan stored in the database
    const plan = await fetchUserTemplate(id);
    if (!plan || !plan.is_template) return null;

    return {
      id: plan.id,
      name: plan.name,
      description: plan.description ?? "",
      tags: plan.tags,
      prompts: [...plan.prompts].sort((a, b) => a.order_index - b.order_index),
    };
  }

  // Built-in template (slug)
  const builtin = getTemplateById(id);
  if (!builtin) return null;

  return {
    id: builtin.id,
    name: builtin.name,
    description: builtin.description,
    tags: builtin.tags,
    prompts: builtin.prompts.map((p, i) => ({
      title: p.title,
      filename: p.filename,
      content: p.content,
      order_index: i,
    })),
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const template = await resolveTemplate(id);

  if (!template) notFound();

  const isBuiltin = !UUID_RE.test(id);
  const promptCount = template.prompts.length;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
      {/* Back link */}
      <div>
        <Button
          render={<Link href="/dashboard/templates" />}
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
          aria-label="Volver a la galería de plantillas"
        >
          <ArrowLeftIcon className="mr-1.5 size-4" aria-hidden="true" />
          Plantillas
        </Button>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">{template.name}</h1>
            {isBuiltin && (
              <Badge variant="secondary" className="text-xs">
                Integrado
              </Badge>
            )}
          </div>
          {template.description && (
            <p className="mt-2 text-sm text-muted-foreground">{template.description}</p>
          )}
        </div>
        <Button
          render={<Link href={`/dashboard/plans/new?template=${template.id}`} />}
          className="shrink-0"
          aria-label={`Usar plantilla: ${template.name}`}
        >
          Usar esta plantilla
        </Button>
      </div>

      {/* Tags */}
      {template.tags.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Etiquetas de la plantilla">
          {template.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <Separator />

      {/* Prompts list */}
      <section aria-labelledby="prompts-heading">
        <h2 id="prompts-heading" className="mb-4 font-heading text-lg font-semibold tracking-tight">
          Prompts <span className="font-normal text-muted-foreground">({promptCount})</span>
        </h2>

        {promptCount === 0 ? (
          <p className="text-sm text-muted-foreground">Esta plantilla no tiene prompts.</p>
        ) : (
          <ol
            className="flex flex-col gap-3"
            aria-label={`${promptCount} prompts en esta plantilla`}
          >
            {template.prompts.map((prompt, i) => {
              const displayTitle = prompt.title ?? prompt.filename ?? `Prompt ${i + 1}`;
              return (
                <li key={`${prompt.filename ?? ""}-${i}`}>
                  <Card className="p-4">
                    <div className="mb-2 flex items-center gap-2.5">
                      <span
                        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
                        aria-hidden="true"
                      >
                        {i + 1}
                      </span>
                      <span className="truncate text-sm font-medium">{displayTitle}</span>
                      {prompt.filename && prompt.title && (
                        <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                          {prompt.filename}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-3 text-xs text-muted-foreground">{prompt.content}</p>
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* CTA footer */}
      <Separator />
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {promptCount} prompt{promptCount !== 1 ? "s" : ""} en esta plantilla
        </p>
        <Button
          render={<Link href={`/dashboard/plans/new?template=${template.id}`} />}
          aria-label={`Usar plantilla: ${template.name}`}
        >
          Usar esta plantilla
        </Button>
      </div>
    </div>
  );
}

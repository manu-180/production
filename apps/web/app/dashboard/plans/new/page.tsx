"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useCreatePlan } from "@/hooks/use-plan-mutations";
import { cn } from "@/lib/utils";
import { ArrowLeftIcon, FileUpIcon, LayersIcon, Loader2Icon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { TemplateGrid } from "./_components/template-grid";
import type { BuiltinTemplate } from "./_components/template-grid";
import { UploadZone } from "./_components/upload-zone";

// ---------------------------------------------------------------------------
// Built-in templates — resolved lazily to avoid hard dependency on a module
// that may not exist yet at build time.
// ---------------------------------------------------------------------------

let cachedTemplates: BuiltinTemplate[] | null = null;

async function loadBuiltinTemplates(): Promise<BuiltinTemplate[]> {
  if (cachedTemplates) return cachedTemplates;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // biome-ignore lint/suspicious/noExplicitAny: dynamic import path requires `any` cast for TypeScript module resolution
    const mod = await import("@/lib/templates/index" as any);
    cachedTemplates = (mod.BUILTIN_TEMPLATES as BuiltinTemplate[]) ?? [];
    return cachedTemplates;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Parsed prompt shape (mirrors plan-importer.ImportedPrompt)
// ---------------------------------------------------------------------------

interface ImportedPrompt {
  filename: string;
  title: string | null;
  content: string;
  frontmatter: Record<string, unknown>;
  order_index: number;
}

async function parseFiles(files: File[]): Promise<ImportedPrompt[]> {
  try {
    const mod = await import("@/lib/plan-editor/plan-importer");
    return mod.parseMarkdownFiles(files);
  } catch {
    // Fallback: read raw text without frontmatter parsing
    const results: ImportedPrompt[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;
      const content = await file.text();
      results.push({
        filename: file.name,
        title: file.name.replace(/\.md$/i, ""),
        content,
        frontmatter: {},
        order_index: i,
      });
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Mode = "blank" | "upload" | "template";

export default function NewPlanPage() {
  const router = useRouter();
  const createPlan = useCreatePlan();

  // Shared state
  const [mode, setMode] = useState<Mode>("blank");

  // Blank form
  const [blankName, setBlankName] = useState("");
  const [blankDescription, setBlankDescription] = useState("");

  // Upload form
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadName, setUploadName] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parsedPrompts, setParsedPrompts] = useState<ImportedPrompt[]>([]);

  // Template form
  const [templates, setTemplates] = useState<BuiltinTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(undefined);
  const [templateName, setTemplateName] = useState("");

  // Load built-in templates once
  useEffect(() => {
    loadBuiltinTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, []);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId),
    [templates, selectedTemplateId],
  );

  // Pre-fill template name when a template is selected
  useEffect(() => {
    if (selectedTemplate) {
      setTemplateName(selectedTemplate.name);
    }
  }, [selectedTemplate]);

  // ---------------------------------------------------------------------------
  // File handling
  // ---------------------------------------------------------------------------

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      // Set upload name from first file if still empty
      setUploadFiles((prev) => {
        const combined = [...prev, ...files];
        if (!uploadName && files[0]) {
          setUploadName(
            files[0].name
              .replace(/\.md$/i, "")
              .replace(/[-_]/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase()),
          );
        }
        return combined;
      });

      setIsParsing(true);
      try {
        const all = [...uploadFiles, ...files];
        const parsed = await parseFiles(all);
        setParsedPrompts(parsed);
      } catch {
        toast.error("Error al analizar los archivos markdown");
      } finally {
        setIsParsing(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [uploadFiles, uploadName],
  );

  const handleRemoveFile = useCallback(
    async (index: number) => {
      const next = uploadFiles.filter((_, i) => i !== index);
      setUploadFiles(next);
      if (next.length === 0) {
        setParsedPrompts([]);
        return;
      }
      setIsParsing(true);
      try {
        const parsed = await parseFiles(next);
        setParsedPrompts(parsed);
      } catch {
        toast.error("Error al volver a analizar los archivos");
      } finally {
        setIsParsing(false);
      }
    },
    [uploadFiles],
  );

  // ---------------------------------------------------------------------------
  // Submit handlers
  // ---------------------------------------------------------------------------

  const handleCreateBlank = useCallback(async () => {
    const name = blankName.trim();
    if (!name) {
      toast.error("El nombre del plan es obligatorio");
      return;
    }
    createPlan.mutate(
      { name, description: blankDescription.trim() || undefined },
      {
        onSuccess: (plan) => {
          toast.success("Plan creado");
          router.push(`/dashboard/plans/${plan.id}`);
        },
      },
    );
  }, [blankName, blankDescription, createPlan, router]);

  const handleCreateFromUpload = useCallback(async () => {
    const name = uploadName.trim();
    if (!name) {
      toast.error("El nombre del plan es obligatorio");
      return;
    }
    if (uploadFiles.length === 0) {
      toast.error("Subí al menos un archivo .md");
      return;
    }

    let prompts = parsedPrompts;
    if (prompts.length === 0 && uploadFiles.length > 0) {
      setIsParsing(true);
      try {
        prompts = await parseFiles(uploadFiles);
        setParsedPrompts(prompts);
      } catch {
        toast.error("Error al analizar los archivos subidos");
        setIsParsing(false);
        return;
      }
      setIsParsing(false);
    }

    createPlan.mutate(
      {
        name,
        prompts: prompts.map((p) => ({
          filename: p.filename,
          title: p.title ?? undefined,
          content: p.content,
          frontmatter: p.frontmatter,
          order_index: p.order_index,
        })),
      },
      {
        onSuccess: (plan) => {
          toast.success(`Plan creado con ${prompts.length} prompts`);
          router.push(`/dashboard/plans/${plan.id}`);
        },
      },
    );
  }, [uploadName, uploadFiles, parsedPrompts, createPlan, router]);

  const handleCreateFromTemplate = useCallback(() => {
    const name = templateName.trim();
    if (!name) {
      toast.error("El nombre del plan es obligatorio");
      return;
    }
    if (!selectedTemplate) {
      toast.error("Seleccioná una plantilla primero");
      return;
    }

    createPlan.mutate(
      {
        name,
        tags: selectedTemplate.tags,
        prompts: selectedTemplate.prompts.map((p, i) => ({
          filename: p.filename,
          title: p.title,
          content: p.content,
          frontmatter: p.frontmatter,
          order_index: i,
        })),
      },
      {
        onSuccess: (plan) => {
          toast.success("Plan creado desde plantilla");
          router.push(`/dashboard/plans/${plan.id}`);
        },
      },
    );
  }, [templateName, selectedTemplate, createPlan, router]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isPending = createPlan.isPending || isParsing;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Volver a planes"
            render={<Link href="/dashboard/plans" />}
          >
            <ArrowLeftIcon aria-hidden="true" />
          </Button>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Nuevo Plan</h1>
        </div>
        <p className="text-sm text-muted-foreground pl-9">Elegí cómo querés empezar.</p>
      </div>

      {/* Mode selector tabs (mobile: stacked; desktop: 3 cols) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ── Card A: Start blank ─────────────────────────────────────────── */}
        <Card
          className={cn(
            "flex flex-col transition-all duration-150",
            mode === "blank"
              ? "ring-2 ring-primary"
              : "cursor-pointer hover:ring-1 hover:ring-primary/30",
          )}
          onClick={() => setMode("blank")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setMode("blank");
          }}
          aria-label="Empezar con un plan en blanco"
        >
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-muted">
                <PlusIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              </div>
              <CardTitle>Empezar en blanco</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              Creá un plan vacío y agregá prompts manualmente en el editor.
            </p>
          </CardHeader>

          <CardContent
            className={cn(
              "flex flex-col gap-4 mt-auto",
              mode !== "blank" && "pointer-events-none opacity-60",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="blank-name">
                Nombre del plan{" "}
                <span aria-hidden="true" className="text-destructive">
                  *
                </span>
              </Label>
              <Input
                id="blank-name"
                value={blankName}
                onChange={(e) => setBlankName(e.target.value)}
                placeholder="ej. Pipeline de revisión de código"
                aria-required="true"
                disabled={mode !== "blank" || isPending}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) handleCreateBlank();
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="blank-description">Descripción</Label>
              <Textarea
                id="blank-description"
                value={blankDescription}
                onChange={(e) => setBlankDescription(e.target.value)}
                placeholder="¿Qué hace este plan?"
                rows={2}
                disabled={mode !== "blank" || isPending}
              />
            </div>
            <Button
              onClick={handleCreateBlank}
              disabled={mode !== "blank" || !blankName.trim() || isPending}
              aria-label="Crear plan en blanco"
              className="w-full"
            >
              {createPlan.isPending && mode === "blank" ? (
                <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <PlusIcon aria-hidden="true" />
              )}
              Crear Plan
            </Button>
          </CardContent>
        </Card>

        {/* ── Card B: Upload files ─────────────────────────────────────────── */}
        <Card
          className={cn(
            "flex flex-col transition-all duration-150",
            mode === "upload"
              ? "ring-2 ring-primary"
              : "cursor-pointer hover:ring-1 hover:ring-primary/30",
          )}
          onClick={() => setMode("upload")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setMode("upload");
          }}
          aria-label="Crear un plan subiendo archivos markdown"
        >
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-muted">
                <FileUpIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              </div>
              <CardTitle>Subir archivos</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              Importá archivos de prompts existentes. Soltá uno o más{" "}
              <code className="rounded bg-muted px-1 text-xs">.md</code> archivos para crear un
              plan.
            </p>
          </CardHeader>

          <CardContent
            className={cn(
              "flex flex-col gap-4 mt-auto",
              mode !== "upload" && "pointer-events-none opacity-60",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <UploadZone
              onFiles={handleFiles}
              currentFiles={uploadFiles}
              onRemoveFile={handleRemoveFile}
            />

            {isParsing && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
                Procesando archivos…
              </div>
            )}

            {uploadFiles.length > 0 && (
              <>
                <Separator />
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="upload-name">
                    Nombre del plan{" "}
                    <span aria-hidden="true" className="text-destructive">
                      *
                    </span>
                  </Label>
                  <Input
                    id="upload-name"
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                    placeholder="ej. Mi pipeline de prompts"
                    aria-required="true"
                    disabled={isPending}
                  />
                </div>
                <Button
                  onClick={handleCreateFromUpload}
                  disabled={!uploadName.trim() || uploadFiles.length === 0 || isPending}
                  aria-label={`Crear plan desde ${uploadFiles.length} archivo${uploadFiles.length === 1 ? "" : "s"}`}
                  className="w-full"
                >
                  {isPending && mode === "upload" ? (
                    <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <FileUpIcon aria-hidden="true" />
                  )}
                  Crear desde {uploadFiles.length} archivo{uploadFiles.length === 1 ? "" : "s"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Card C: From template ────────────────────────────────────────── */}
        <Card
          className={cn(
            "flex flex-col transition-all duration-150",
            mode === "template"
              ? "ring-2 ring-primary"
              : "cursor-pointer hover:ring-1 hover:ring-primary/30",
          )}
          onClick={() => setMode("template")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setMode("template");
          }}
          aria-label="Crear un plan desde una plantilla"
        >
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-muted">
                <LayersIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              </div>
              <CardTitle>Desde plantilla</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              Comenzá desde una plantilla prediseñada con prompts listos para flujos de trabajo
              comunes.
            </p>
          </CardHeader>

          <CardContent
            className={cn(
              "flex flex-col gap-4 mt-auto",
              mode !== "template" && "pointer-events-none opacity-60",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <TemplateGrid
              templates={templates}
              selectedId={selectedTemplateId}
              onSelect={(id) => {
                setSelectedTemplateId(id);
                setMode("template");
              }}
            />

            {selectedTemplate && (
              <>
                <Separator />
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="template-name">
                    Nombre del plan{" "}
                    <span aria-hidden="true" className="text-destructive">
                      *
                    </span>
                  </Label>
                  <Input
                    id="template-name"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="ej. Mi pipeline personalizado"
                    aria-required="true"
                    disabled={isPending}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) handleCreateFromTemplate();
                    }}
                  />
                </div>
                <Button
                  onClick={handleCreateFromTemplate}
                  disabled={!templateName.trim() || !selectedTemplate || isPending}
                  aria-label={`Crear plan desde la plantilla: ${selectedTemplate.name}`}
                  className="w-full"
                >
                  {createPlan.isPending && mode === "template" ? (
                    <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <LayersIcon aria-hidden="true" />
                  )}
                  Crear desde plantilla
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

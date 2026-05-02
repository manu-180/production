"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  BookOpenIcon,
  BrainIcon,
  CheckIcon,
  CodeIcon,
  FileTextIcon,
  LayersIcon,
  PenToolIcon,
  RocketIcon,
  SearchIcon,
  WrenchIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Import the type via interface declaration since lib/templates may not exist yet
export interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
  prompts: Array<{
    filename: string;
    title: string;
    content: string;
    frontmatter: Record<string, unknown>;
  }>;
}

/** Map template tags/ids to representative icons. */
function getTemplateIcon(template: BuiltinTemplate): LucideIcon {
  const combined = `${template.id} ${template.tags.join(" ")}`.toLowerCase();
  if (combined.includes("code") || combined.includes("dev")) return CodeIcon;
  if (combined.includes("write") || combined.includes("content") || combined.includes("blog"))
    return PenToolIcon;
  if (combined.includes("research") || combined.includes("search")) return SearchIcon;
  if (combined.includes("review")) return BookOpenIcon;
  if (combined.includes("refactor") || combined.includes("debug")) return WrenchIcon;
  if (combined.includes("brain") || combined.includes("reason")) return BrainIcon;
  if (combined.includes("deploy") || combined.includes("launch")) return RocketIcon;
  if (combined.includes("pipeline") || combined.includes("workflow")) return LayersIcon;
  return FileTextIcon;
}

interface TemplateGridProps {
  templates: BuiltinTemplate[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

export function TemplateGrid({ templates, selectedId, onSelect }: TemplateGridProps) {
  if (templates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-8 text-center">
        <LayersIcon className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">No hay plantillas disponibles</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Seleccionar una plantilla">
      {templates.map((template) => {
        const Icon = getTemplateIcon(template);
        const isSelected = selectedId === template.id;

        return (
          <button
            key={template.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(template.id)}
            className={cn(
              "group relative flex flex-col gap-2 rounded-xl border p-3 text-left transition-all outline-none",
              "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
              isSelected
                ? "border-primary bg-primary/5 ring-2 ring-primary"
                : "border-border bg-card hover:border-primary/40 hover:bg-muted/30",
            )}
          >
            {/* Selected checkmark */}
            {isSelected && (
              <span className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <CheckIcon className="size-3" aria-hidden="true" />
              </span>
            )}

            {/* Icon + name */}
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                  isSelected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
              </div>
              <span className="font-medium text-sm leading-tight text-foreground">
                {template.name}
              </span>
            </div>

            {/* Description */}
            <p className="line-clamp-2 text-xs text-muted-foreground leading-relaxed">
              {template.description}
            </p>

            {/* Tags + prompt count */}
            <div className="flex flex-wrap items-center gap-1.5">
              {template.tags.slice(0, 2).map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
              {template.prompts.length > 0 && (
                <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                  {template.prompts.length} {template.prompts.length === 1 ? "prompt" : "prompts"}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

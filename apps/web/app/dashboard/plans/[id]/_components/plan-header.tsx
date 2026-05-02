"use client";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUpdatePlan } from "@/hooks/use-plan-mutations";
import type { Plan } from "@conductor/db";
import { ExternalLinkIcon, FolderIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface PlanHeaderProps {
  plan: Plan;
}

export function PlanHeader({ plan }: PlanHeaderProps) {
  const updatePlan = useUpdatePlan();

  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description ?? "");
  const [isTemplate, setIsTemplate] = useState(plan.is_template);
  const [workingDir, setWorkingDir] = useState(plan.default_working_dir ?? "");

  // Sync if plan changes externally (e.g. after invalidation)
  const prevIdRef = useRef(plan.id);
  useEffect(() => {
    if (prevIdRef.current !== plan.id) {
      setName(plan.name);
      setDescription(plan.description ?? "");
      setIsTemplate(plan.is_template);
      setWorkingDir(plan.default_working_dir ?? "");
      prevIdRef.current = plan.id;
    }
  }, [plan]);

  function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === plan.name) return;
    updatePlan.mutate({ planId: plan.id, data: { name: trimmed } });
  }

  function saveDescription() {
    const trimmed = description.trim();
    const current = plan.description ?? "";
    if (trimmed === current) return;
    updatePlan.mutate({
      planId: plan.id,
      data: { description: trimmed || null },
    });
  }

  function saveWorkingDir() {
    const trimmed = workingDir.trim();
    const current = plan.default_working_dir ?? "";
    if (trimmed === current) return;
    updatePlan.mutate({
      planId: plan.id,
      data: { default_working_dir: trimmed || null },
    });
  }

  function handleTemplateToggle(checked: boolean) {
    setIsTemplate(checked);
    updatePlan.mutate({ planId: plan.id, data: { is_template: checked } });
  }

  return (
    <div className="flex items-start justify-between border-b border-border pb-4 gap-4">
      {/* Left: name, description, tags, working dir */}
      <div className="flex flex-col gap-2 min-w-0 flex-1">
        {/* Inline editable plan name */}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setName(plan.name);
              e.currentTarget.blur();
            }
          }}
          className="text-xl font-semibold bg-transparent border-none outline-none focus:underline decoration-dashed underline-offset-4 truncate max-w-xl"
          placeholder="Plan sin título"
          aria-label="Nombre del plan"
        />

        {/* Inline editable description */}
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={saveDescription}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDescription(plan.description ?? "");
              e.currentTarget.blur();
            }
          }}
          className="text-sm text-muted-foreground bg-transparent border-none outline-none focus:underline decoration-dashed underline-offset-4 max-w-xl"
          placeholder="Agregá una descripción..."
          aria-label="Descripción del plan"
        />

        {/* Tags */}
        {plan.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {plan.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Default working directory */}
        <div className="flex items-center gap-2 mt-1">
          <FolderIcon className="size-3.5 text-muted-foreground shrink-0" />
          <input
            value={workingDir}
            onChange={(e) => setWorkingDir(e.target.value)}
            onBlur={saveWorkingDir}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setWorkingDir(plan.default_working_dir ?? "");
                e.currentTarget.blur();
              }
            }}
            className="text-xs text-muted-foreground bg-transparent border-none outline-none focus:underline decoration-dashed underline-offset-4 font-mono min-w-0 flex-1"
            placeholder="Directorio de trabajo por defecto..."
            aria-label="Directorio de trabajo por defecto"
          />
        </div>
      </div>

      {/* Right: template toggle + view runs link */}
      <div className="flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <Switch
            id="is-template"
            checked={isTemplate}
            onCheckedChange={handleTemplateToggle}
            disabled={updatePlan.isPending}
          />
          <Label htmlFor="is-template" className="text-sm cursor-pointer">
            Plantilla
          </Label>
        </div>

        <Link
          href={`/dashboard/plans/${plan.id}/runs`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Ver ejecuciones
          <ExternalLinkIcon className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}

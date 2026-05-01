"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUpdatePrompt } from "@/hooks/use-plan-mutations";
import {
  ALLOWED_TOOLS,
  type PromptFrontmatter,
  defaultFrontmatter,
} from "@/lib/plan-editor/frontmatter-validators";
import type { Prompt } from "@conductor/db";
import { useCallback, useEffect, useRef } from "react";
import { Controller, useForm } from "react-hook-form";

interface FrontmatterFormProps {
  prompt: Prompt;
  planId: string;
  onChange?: (fm: Record<string, unknown>) => void;
}

const DEBOUNCE_MS = 800;

const PERMISSION_MODES = [
  { value: "default", label: "Default" },
  { value: "acceptEdits", label: "Accept Edits" },
  { value: "bypassPermissions", label: "Bypass Permissions" },
] as const;

export function FrontmatterForm({ prompt, planId, onChange }: FrontmatterFormProps) {
  const updatePrompt = useUpdatePrompt(planId);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const form = useForm<PromptFrontmatter>({
    defaultValues: {
      ...defaultFrontmatter,
      ...(prompt.frontmatter as PromptFrontmatter),
    },
  });

  // Reset when prompt changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset only when prompt ID changes; including form.reset and prompt.frontmatter would cause infinite reset loops
  useEffect(() => {
    form.reset({
      ...defaultFrontmatter,
      ...(prompt.frontmatter as PromptFrontmatter),
    });
  }, [prompt.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save on form value changes (debounced)
  const values = form.watch();
  const prevValuesRef = useRef<string>("");

  const doSave = useCallback(
    (vals: PromptFrontmatter) => {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(vals)) {
        if (v !== undefined) cleaned[k] = v;
      }
      updatePrompt.mutate({ promptId: prompt.id, data: { frontmatter: cleaned } });
      onChange?.(cleaned);
    },
    [updatePrompt.mutate, prompt.id, onChange],
  );

  useEffect(() => {
    const serialized = JSON.stringify(values);
    if (serialized === prevValuesRef.current) return;
    prevValuesRef.current = serialized;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => doSave(values), DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [values, doSave]);

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* Title */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fm-title" className="text-xs font-medium">
          Title
        </Label>
        <Input
          id="fm-title"
          {...form.register("title")}
          placeholder="Prompt title"
          className="h-8 text-sm"
        />
      </div>

      {/* Boolean toggles */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="fm-continue-session" className="text-xs font-medium cursor-pointer">
            Continue session
          </Label>
          <Controller
            control={form.control}
            name="continueSession"
            render={({ field }) => (
              <Switch
                id="fm-continue-session"
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="fm-requires-approval" className="text-xs font-medium cursor-pointer">
            Requires approval
          </Label>
          <Controller
            control={form.control}
            name="requiresApproval"
            render={({ field }) => (
              <Switch
                id="fm-requires-approval"
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="fm-rollback" className="text-xs font-medium cursor-pointer">
            Rollback on fail
          </Label>
          <Controller
            control={form.control}
            name="rollbackOnFail"
            render={({ field }) => (
              <Switch
                id="fm-rollback"
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </div>
      </div>

      {/* Allowed tools */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium">Allowed tools</Label>
        <Controller
          control={form.control}
          name="allowedTools"
          render={({ field }) => {
            const selected = field.value ?? [];
            return (
              <div className="grid grid-cols-2 gap-1.5">
                {ALLOWED_TOOLS.map((tool) => {
                  const checked = selected.includes(tool);
                  return (
                    <label key={tool} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded border-border accent-primary"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            field.onChange([...selected, tool]);
                          } else {
                            field.onChange(selected.filter((t) => t !== tool));
                          }
                        }}
                      />
                      <span>{tool}</span>
                    </label>
                  );
                })}
              </div>
            );
          }}
        />
      </div>

      {/* Permission mode */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fm-permission-mode" className="text-xs font-medium">
          Permission mode
        </Label>
        <Controller
          control={form.control}
          name="permissionMode"
          render={({ field }) => (
            <select
              id="fm-permission-mode"
              value={field.value ?? "default"}
              onChange={(e) =>
                field.onChange(e.target.value as PromptFrontmatter["permissionMode"])
              }
              className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {PERMISSION_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          )}
        />
      </div>

      {/* Numeric fields */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fm-max-turns" className="text-xs font-medium">
            Max turns
          </Label>
          <Input
            id="fm-max-turns"
            type="number"
            min={1}
            max={500}
            className="h-8 text-sm"
            {...form.register("maxTurns", {
              valueAsNumber: true,
              min: 1,
              max: 500,
            })}
            placeholder="50"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fm-retries" className="text-xs font-medium">
            Retries
          </Label>
          <Input
            id="fm-retries"
            type="number"
            min={0}
            max={5}
            className="h-8 text-sm"
            {...form.register("retries", {
              valueAsNumber: true,
              min: 0,
              max: 5,
            })}
            placeholder="0"
          />
        </div>

        <div className="flex flex-col gap-1.5 col-span-2">
          <Label htmlFor="fm-max-budget" className="text-xs font-medium">
            Max budget (USD)
          </Label>
          <Input
            id="fm-max-budget"
            type="number"
            min={0.01}
            max={100}
            step={0.01}
            className="h-8 text-sm"
            {...form.register("maxBudgetUsd", {
              valueAsNumber: true,
              min: 0.01,
              max: 100,
            })}
            placeholder="Optional"
          />
        </div>
      </div>
    </div>
  );
}

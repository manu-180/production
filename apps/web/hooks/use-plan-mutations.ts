"use client";
import { apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";
import type { Plan, Prompt } from "@conductor/db";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// ─── Plan create ──────────────────────────────────────────────────────────────

interface PlanCreateData {
  name: string;
  description?: string;
  tags?: string[];
  is_template?: boolean;
  default_working_dir?: string;
  default_settings?: Record<string, unknown>;
  prompts?: Array<{
    filename?: string;
    title?: string;
    content: string;
    frontmatter?: Record<string, unknown>;
    order_index?: number;
  }>;
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation<Plan, Error, PlanCreateData>({
    mutationFn: (data) => apiClient.post<Plan>("/api/plans", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.plans.all() });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

// ─── Plan update ──────────────────────────────────────────────────────────────

interface PlanUpdateVars {
  planId: string;
  data: {
    name?: string;
    description?: string | null;
    tags?: string[];
    is_template?: boolean;
    default_working_dir?: string | null;
    default_settings?: Record<string, unknown>;
  };
}

export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation<Plan, Error, PlanUpdateVars>({
    mutationFn: ({ planId, data }) => apiClient.patch<Plan>(`/api/plans/${planId}`, data),
    onSuccess: (_result, { planId }) => {
      qc.invalidateQueries({ queryKey: qk.plans.detail(planId) });
      qc.invalidateQueries({ queryKey: qk.plans.all() });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

// ─── Plan delete ──────────────────────────────────────────────────────────────

export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (planId) => apiClient.delete<void>(`/api/plans/${planId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.plans.all() });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

// ─── Prompt create ────────────────────────────────────────────────────────────

interface PromptCreateData {
  filename?: string;
  title?: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  order_index?: number;
}

export function useCreatePrompt(planId: string) {
  const qc = useQueryClient();
  return useMutation<Prompt, Error, PromptCreateData>({
    mutationFn: (data) => apiClient.post<Prompt>(`/api/plans/${planId}/prompts`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.plans.detail(planId) });
      qc.invalidateQueries({ queryKey: qk.plans.prompts(planId) });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

// ─── Prompt update ────────────────────────────────────────────────────────────

interface PromptUpdateVars {
  promptId: string;
  data: {
    title?: string | null;
    filename?: string | null;
    content?: string;
    frontmatter?: Record<string, unknown>;
    order_index?: number;
  };
}

export function useUpdatePrompt(planId: string) {
  const qc = useQueryClient();
  return useMutation<Prompt, Error, PromptUpdateVars>({
    mutationFn: ({ promptId, data }) =>
      apiClient.patch<Prompt>(`/api/plans/${planId}/prompts/${promptId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.plans.detail(planId) });
      qc.invalidateQueries({ queryKey: qk.plans.prompts(planId) });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

// ─── Prompt delete ────────────────────────────────────────────────────────────

export function useDeletePrompt(planId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (promptId) => apiClient.delete<void>(`/api/plans/${planId}/prompts/${promptId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.plans.detail(planId) });
      qc.invalidateQueries({ queryKey: qk.plans.prompts(planId) });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

// ─── Prompt reorder ───────────────────────────────────────────────────────────

export function useReorderPrompts(planId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string[]>({
    mutationFn: (ordered) =>
      apiClient.post<void>(`/api/plans/${planId}/prompts/reorder`, { ordered }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.plans.detail(planId) });
      qc.invalidateQueries({ queryKey: qk.plans.prompts(planId) });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

// ─── Trigger run ──────────────────────────────────────────────────────────────

interface TriggerRunVars {
  planId: string;
  workingDir: string;
  dryRun?: boolean;
}

interface TriggerRunResponse {
  id: string;
}

export function useTriggerRun() {
  return useMutation<TriggerRunResponse, Error, TriggerRunVars>({
    mutationFn: ({ planId, workingDir, dryRun }) =>
      apiClient.post<TriggerRunResponse>(`/api/plans/${planId}/runs`, {
        workingDir,
        dryRun,
      }),
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

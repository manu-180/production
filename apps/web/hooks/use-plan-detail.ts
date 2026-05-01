"use client";
import { apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";
import type { Plan, Prompt } from "@conductor/db";
import { useQuery } from "@tanstack/react-query";

export type PlanWithPrompts = Plan & { prompts: Prompt[] };

export function usePlanDetail(planId: string) {
  return useQuery<PlanWithPrompts>({
    queryKey: qk.plans.detail(planId),
    queryFn: ({ signal }) => apiClient.get<PlanWithPrompts>(`/api/plans/${planId}`, { signal }),
    staleTime: 10_000,
    enabled: planId.length > 0,
  });
}

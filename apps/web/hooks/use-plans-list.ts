"use client";
import { apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";
import type { Plan } from "@conductor/db";
import { useInfiniteQuery } from "@tanstack/react-query";

interface ListResponse {
  plans: Plan[];
  nextCursor?: string;
}

export interface PlansListParams {
  tag?: string;
  search?: string;
  isTemplate?: boolean;
  limit?: number;
}

function buildQS(params: PlansListParams, cursor: string | undefined): string {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.tag) qs.set("tag", params.tag);
  if (params.isTemplate !== undefined) qs.set("is_template", String(params.isTemplate));
  qs.set("limit", String(params.limit ?? 25));
  if (cursor) qs.set("cursor", cursor);
  return qs.toString();
}

export function usePlansList(params: PlansListParams = {}) {
  return useInfiniteQuery({
    queryKey: qk.plans.list(params as Record<string, unknown>),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiClient.get<ListResponse>(`/api/plans?${buildQS(params, pageParam)}`, { signal }),
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 15_000,
  });
}

/** Convenience wrapper that only returns template plans. */
export function useTemplatesList(extraParams: Omit<PlansListParams, "isTemplate"> = {}) {
  return usePlansList({ ...extraParams, isTemplate: true });
}

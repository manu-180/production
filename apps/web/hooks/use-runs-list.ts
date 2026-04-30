"use client";
import type { Run } from "@conductor/db";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";
import type { RunStatus } from "@/lib/ui/status";

interface ListResponse {
  runs: Run[];
  nextCursor?: string;
}

export interface RunsListParams {
  status?: RunStatus;
  planId?: string;
  limit?: number;
}

function buildQS(params: RunsListParams, cursor: string | undefined): string {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.planId) qs.set("planId", params.planId);
  qs.set("limit", String(params.limit ?? 25));
  if (cursor) qs.set("cursor", cursor);
  return qs.toString();
}

export function useRunsList(params: RunsListParams = {}) {
  return useInfiniteQuery({
    queryKey: qk.runs.list(params as Record<string, unknown>),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiClient.get<ListResponse>(`/api/runs?${buildQS(params, pageParam)}`, { signal }),
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 10_000,
  });
}

/** Convenience wrapper for active runs (running + paused). Polls a bit fresher. */
export function useActiveRuns() {
  // No multi-status filter on the API yet — fetch a bigger window and filter client-side.
  return useInfiniteQuery({
    queryKey: qk.runs.list({ active: true }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const qs = new URLSearchParams();
      qs.set("limit", "50");
      if (pageParam) qs.set("cursor", pageParam);
      return apiClient.get<ListResponse>(`/api/runs?${qs.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
    select: (data) => ({
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        runs: page.runs.filter(
          (r) => r.status === "running" || r.status === "paused",
        ),
      })),
    }),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

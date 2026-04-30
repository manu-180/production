"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";
import {
  type RunDetailCache,
  seedCache,
} from "@/lib/realtime/event-handlers";

type ApiResponse = Omit<RunDetailCache, "_lastAppliedSequence">;

export function useRunDetail(runId: string) {
  return useQuery<RunDetailCache>({
    queryKey: qk.runs.detail(runId),
    queryFn: async ({ signal }) => {
      const data = await apiClient.get<ApiResponse>(`/api/runs/${runId}`, { signal });
      return seedCache(data);
    },
    // staleTime is high — realtime keeps the cache fresh by event patches.
    staleTime: 60_000,
  });
}

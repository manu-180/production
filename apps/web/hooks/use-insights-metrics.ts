"use client";
import { apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";
import type { GuardianDailyMetric, PromptMetric, RunsDailyMetric } from "@conductor/core";
import { useQuery } from "@tanstack/react-query";

export interface InsightsMetricsResponse {
  runsByDay: RunsDailyMetric[];
  promptStats: PromptMetric[];
  guardianByDay: GuardianDailyMetric[];
}

export function useInsightsMetrics(days = 30) {
  return useQuery<InsightsMetricsResponse>({
    queryKey: qk.insights.metrics(days),
    queryFn: async ({ signal }) => {
      return apiClient.get<InsightsMetricsResponse>(`/api/insights/metrics?days=${days}`, {
        signal,
      });
    },
    staleTime: 60_000,
  });
}

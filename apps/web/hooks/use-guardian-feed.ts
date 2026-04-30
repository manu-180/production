"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";
import { subscribeRunBus } from "@/lib/realtime/event-bus";

export interface GuardianDecisionRow {
  id: string;
  prompt_execution_id: string;
  question_detected: string;
  reasoning: string | null;
  decision: string;
  confidence: number;
  strategy: string;
  decided_at: string;
  reviewed_by_human: boolean;
  overridden_by_human: boolean;
}

interface ApiResponse {
  decisions: GuardianDecisionRow[];
}

export function useGuardianFeed(runId: string) {
  const qc = useQueryClient();

  useEffect(() => {
    const off = subscribeRunBus(runId, (ev) => {
      if (ev.eventType === "prompt.guardian_intervention") {
        qc.invalidateQueries({ queryKey: qk.runs.decisions(runId) });
      }
    });
    return off;
  }, [runId, qc]);

  return useQuery<GuardianDecisionRow[]>({
    queryKey: qk.runs.decisions(runId),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<ApiResponse>(
        `/api/runs/${runId}/decisions`,
        { signal },
      );
      return res.decisions;
    },
    staleTime: 15_000,
  });
}

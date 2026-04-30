"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiClientError, apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";
import type { RunDetailCache } from "@/lib/realtime/event-handlers";
import type { RunStatus } from "@/lib/ui/status";

interface UseActionOptions {
  optimisticStatus?: RunStatus;
  pendingMessage: string;
  successMessage: string;
}

export function useRunActions(runId: string) {
  const qc = useQueryClient();

  function makeMutation(path: string, opts: UseActionOptions) {
    return useMutation({
      mutationFn: async () => apiClient.post<unknown>(`/api/runs/${runId}${path}`),
      onMutate: async () => {
        toast.loading(opts.pendingMessage, { id: `run-action-${path}` });
        if (!opts.optimisticStatus) return { prev: undefined };
        await qc.cancelQueries({ queryKey: qk.runs.detail(runId) });
        const prev = qc.getQueryData<RunDetailCache>(qk.runs.detail(runId));
        if (prev) {
          qc.setQueryData<RunDetailCache>(qk.runs.detail(runId), {
            ...prev,
            status: opts.optimisticStatus,
          });
        }
        return { prev };
      },
      onError: (err, _v, ctx) => {
        if (ctx?.prev) {
          qc.setQueryData(qk.runs.detail(runId), ctx.prev);
        }
        const isApi = err instanceof ApiClientError;
        toast.error(isApi ? err.message : "Action failed", {
          id: `run-action-${path}`,
          description: isApi ? `Trace: ${err.traceId}` : undefined,
        });
      },
      onSuccess: () => {
        toast.success(opts.successMessage, { id: `run-action-${path}` });
        qc.invalidateQueries({ queryKey: qk.runs.detail(runId) });
        qc.invalidateQueries({ queryKey: qk.runs.list({ active: true }) });
      },
    });
  }

  return {
    pause: makeMutation("/pause", {
      optimisticStatus: "paused",
      pendingMessage: "Pausing run…",
      successMessage: "Run paused",
    }),
    resume: makeMutation("/resume", {
      optimisticStatus: "running",
      pendingMessage: "Resuming run…",
      successMessage: "Run resumed",
    }),
    cancel: makeMutation("/cancel", {
      optimisticStatus: "cancelled",
      pendingMessage: "Cancelling run…",
      successMessage: "Run cancelled",
    }),
    retry: makeMutation("/retry", {
      pendingMessage: "Retrying…",
      successMessage: "Retry triggered",
    }),
  };
}

interface ApprovalParams {
  promptId: string;
  decision: "approve" | "reject";
  reason?: string;
}

export function useApprovePromptMutation(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: ApprovalParams) =>
      apiClient.post<unknown>(`/api/runs/${runId}/approve-prompt`, p),
    onSuccess: () => {
      toast.success("Decision recorded");
      qc.invalidateQueries({ queryKey: qk.runs.detail(runId) });
    },
    onError: (err) => {
      const isApi = err instanceof ApiClientError;
      toast.error(isApi ? err.message : "Failed to record decision", {
        description: isApi ? `Trace: ${err.traceId}` : undefined,
      });
    },
  });
}

export function useSkipPromptMutation(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { promptId: string; reason?: string }) =>
      apiClient.post<unknown>(`/api/runs/${runId}/skip-prompt`, p),
    onSuccess: () => {
      toast.success("Prompt skipped");
      qc.invalidateQueries({ queryKey: qk.runs.detail(runId) });
    },
    onError: (err) => {
      const isApi = err instanceof ApiClientError;
      toast.error(isApi ? err.message : "Failed to skip prompt", {
        description: isApi ? `Trace: ${err.traceId}` : undefined,
      });
    },
  });
}

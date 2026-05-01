"use client";
import { apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";
import type { Plan, Schedule } from "@conductor/db";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Schedule row as returned by the API — includes the nested plan stub. */
export interface ScheduleWithPlan extends Schedule {
  plans: Pick<Plan, "id" | "name"> | null;
}

interface SchedulesListResponse {
  schedules: ScheduleWithPlan[];
}

// ─── List ─────────────────────────────────────────────────────────────────────

export function useSchedulesList() {
  return useQuery({
    queryKey: qk.schedules.list(),
    queryFn: ({ signal }) => apiClient.get<SchedulesListResponse>("/api/schedules", { signal }),
    staleTime: 15_000,
  });
}

// ─── Create ───────────────────────────────────────────────────────────────────

export interface ScheduleCreateData {
  name: string;
  plan_id: string;
  cron_expression: string;
  working_dir?: string;
  skip_if_running?: boolean;
  skip_if_recent_hours?: number | null;
  quiet_hours_start?: number | null;
  quiet_hours_end?: number | null;
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation<ScheduleWithPlan, Error, ScheduleCreateData>({
    mutationFn: (data) => apiClient.post<ScheduleWithPlan>("/api/schedules", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.schedules.all() });
      toast.success("Schedule created");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

// ─── Update ───────────────────────────────────────────────────────────────────

export interface ScheduleUpdateVars {
  id: string;
  data: Partial<ScheduleCreateData> & { enabled?: boolean };
}

export function useUpdateSchedule() {
  const qc = useQueryClient();
  return useMutation<ScheduleWithPlan, Error, ScheduleUpdateVars>({
    mutationFn: ({ id, data }) => apiClient.patch<ScheduleWithPlan>(`/api/schedules/${id}`, data),
    onSuccess: (_result, { id }) => {
      qc.invalidateQueries({ queryKey: qk.schedules.detail(id) });
      qc.invalidateQueries({ queryKey: qk.schedules.all() });
      toast.success("Schedule updated");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiClient.delete<void>(`/api/schedules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.schedules.all() });
      toast.success("Schedule deleted");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

export function useToggleSchedule() {
  const qc = useQueryClient();
  return useMutation<ScheduleWithPlan, Error, string>({
    mutationFn: (id) => apiClient.post<ScheduleWithPlan>(`/api/schedules/${id}/toggle`),
    onSuccess: (_result, id) => {
      qc.invalidateQueries({ queryKey: qk.schedules.detail(id) });
      qc.invalidateQueries({ queryKey: qk.schedules.all() });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

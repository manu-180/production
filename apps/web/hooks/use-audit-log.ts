"use client";
import { apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";
import { useQuery } from "@tanstack/react-query";

export interface AuditLogEntry {
  id: number;
  user_id: string;
  actor: "user" | "worker" | "guardian" | "system";
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditLogResponse {
  entries: AuditLogEntry[];
  total: number;
  page: number;
  hasMore: boolean;
}

export interface AuditLogFilters {
  page?: number;
  limit?: number;
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  resource_type?: string;
  q?: string;
}

export function useAuditLog(filters: AuditLogFilters = {}) {
  const params = buildParams(filters);
  return useQuery<AuditLogResponse>({
    queryKey: qk.insights.audit(filters as Record<string, unknown>),
    queryFn: async ({ signal }) => {
      return apiClient.get<AuditLogResponse>(`/api/insights/audit?${params}`, { signal });
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function buildAuditExportUrl(filters: Omit<AuditLogFilters, "page" | "limit">): string {
  const params = buildParams({ ...filters, format: "csv" });
  return `/api/insights/audit?${params}`;
}

function buildParams(filters: AuditLogFilters & { format?: string }): string {
  const p = new URLSearchParams();
  if (filters.page !== undefined) p.set("page", String(filters.page));
  if (filters.limit !== undefined) p.set("limit", String(filters.limit));
  if (filters.actor) p.set("actor", filters.actor);
  if (filters.action) p.set("action", filters.action);
  if (filters.from) p.set("from", filters.from);
  if (filters.to) p.set("to", filters.to);
  if (filters.resource_type) p.set("resource_type", filters.resource_type);
  if (filters.q) p.set("q", filters.q);
  if (filters.format) p.set("format", filters.format);
  return p.toString();
}

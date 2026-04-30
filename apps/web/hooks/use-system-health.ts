"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { qk } from "@/lib/react-query/keys";

export interface SystemHealth {
  web: "ok";
  db: "ok" | "down";
  worker: "ok" | "offline" | "unknown";
  claudeCli: { installed: boolean; version?: string };
}

export function useSystemHealth() {
  return useQuery<SystemHealth>({
    queryKey: qk.system.health(),
    queryFn: ({ signal }) => apiClient.get<SystemHealth>("/api/system/health", { signal }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

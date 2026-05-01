/** Typed query-key factory. Single source of truth for cache lookups. */
export const qk = {
  plans: {
    all: () => ["plans"] as const,
    list: (params: Record<string, unknown>) => ["plans", "list", params] as const,
    detail: (id: string) => ["plans", "detail", id] as const,
    prompts: (id: string) => ["plans", id, "prompts"] as const,
  },
  runs: {
    all: () => ["runs"] as const,
    list: (params: Record<string, unknown>) => ["runs", "list", params] as const,
    detail: (id: string) => ["runs", "detail", id] as const,
    logs: (id: string, executionId?: string) => ["runs", id, "logs", executionId ?? null] as const,
    decisions: (id: string) => ["runs", id, "decisions"] as const,
  },
  schedules: {
    all: () => ["schedules"] as const,
    list: () => ["schedules", "list"] as const,
    detail: (id: string) => ["schedules", "detail", id] as const,
  },
  settings: { detail: () => ["settings"] as const },
  notifications: {
    preferences: () => ["notifications", "preferences"] as const,
    channels: () => ["notifications", "channels"] as const,
  },
  system: { health: () => ["system", "health"] as const },
  kpis: () => ["dashboard", "kpis"] as const,
  integrations: {
    all: () => ["integrations"] as const,
    list: () => ["integrations", "list"] as const,
    detail: (id: string) => ["integrations", "detail", id] as const,
  },
  insights: {
    metrics: (days: number) => ["insights", "metrics", days] as const,
    audit: (params: Record<string, unknown>) => ["insights", "audit", params] as const,
  },
} as const;

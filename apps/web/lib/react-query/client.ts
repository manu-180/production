import { QueryClient } from "@tanstack/react-query";

/**
 * Server state with sensible defaults. Realtime updates patch the cache
 * directly, so global staleTime can be high — our freshness comes from
 * pushed events, not polling.
 *
 * Offline graceful mode: queries use refetchOnReconnect to re-fetch when
 * connection is restored. Retries respect navigator.onLine to avoid
 * hammering the server when offline.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000, // 1 minute — data stays fresh for 1 min
        gcTime: 5 * 60_000, // 5 minutes — keep in cache even if unused
        refetchOnWindowFocus: false,
        refetchOnReconnect: true, // Re-fetch when coming back online
        retry: (failureCount, error) => {
          // Don't retry if offline
          if (typeof navigator !== "undefined" && !navigator.onLine) {
            return false;
          }

          const code = (error as { code?: string }).code;
          if (code === "unauthorized" || code === "forbidden" || code === "not_found") {
            return false;
          }

          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

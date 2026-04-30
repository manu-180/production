import { QueryClient } from "@tanstack/react-query";

/**
 * Server state with sensible defaults. Realtime updates patch the cache
 * directly, so global staleTime can be high — our freshness comes from
 * pushed events, not polling.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          const code = (error as { code?: string }).code;
          if (
            code === "unauthorized" ||
            code === "forbidden" ||
            code === "not_found"
          ) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

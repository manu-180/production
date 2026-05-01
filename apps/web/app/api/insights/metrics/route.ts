import { defineRoute, respond, respondError } from "@/lib/api";
import type { GuardianDbClient as DbClient } from "@conductor/core";
import { MetricsCollector } from "@conductor/core";
import { createServiceClient } from "@conductor/db";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
type InsightsMetricsQuery = z.infer<typeof querySchema>;

/**
 * GET /api/insights/metrics?days=30
 *
 * Returns consolidated metrics data from the materialized views.
 * Uses service-role client so it can bypass RLS on the views.
 */
export const GET = defineRoute<undefined, InsightsMetricsQuery>(
  { querySchema },
  async ({ user, traceId, query }) => {
    try {
      // ServiceClient satisfies the DbClient interface required by MetricsCollector
      const db = createServiceClient() as unknown as DbClient;
      const collector = new MetricsCollector(db);

      const [runsByDay, promptStats, guardianByDay] = await Promise.all([
        collector.getRunsDaily(user.userId, query.days),
        collector.getPromptsAggregate(),
        collector.getGuardianDaily(query.days),
      ]);

      return respond({ runsByDay, promptStats, guardianByDay }, { traceId });
    } catch (err) {
      return respondError("internal", "Failed to load insights metrics", {
        traceId,
        details:
          process.env["NODE_ENV"] === "development"
            ? { cause: err instanceof Error ? err.message : String(err) }
            : undefined,
      });
    }
  },
);

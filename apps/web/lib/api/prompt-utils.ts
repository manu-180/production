import { createHash } from "node:crypto";
import type { ServiceClient } from "@conductor/db";

/** SHA-256 hex of a string body. Stable: matches `prompt_executions.content_hash` upstream. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Resolve the next `order_index` for a plan: max+1 (or 0 when empty).
 * Used by `POST /plans/:id/prompts` when no explicit order_index is supplied.
 */
export async function nextOrderIndex(db: ServiceClient, planId: string): Promise<number> {
  const { data } = await db
    .from("prompts")
    .select("order_index")
    .eq("plan_id", planId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data === null || data === undefined) return 0;
  return (data.order_index ?? -1) + 1;
}

/**
 * Verify the given plan exists and belongs to `userId`. Returns the plan id on
 * success, `null` when not found / not owned. Use to short-circuit nested
 * routes (`/plans/:id/prompts`, `/plans/:id/runs`) before any work.
 */
export async function assertPlanOwned(
  db: ServiceClient,
  planId: string,
  userId: string,
): Promise<{ id: string } | null> {
  const { data } = await db
    .from("plans")
    .select("id")
    .eq("id", planId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

import { defineRoute, respond, respondError } from "@/lib/api";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

/**
 * POST /api/schedules/:id/toggle — flip the enabled flag.
 * Returns the updated schedule row with plan info.
 */
export const POST = defineRoute<undefined, undefined, Params>(
  { rateLimit: "mutation" },
  async ({ user, traceId, params }) => {
    // Fetch current state first to determine the flip value.
    const { data: existing, error: fetchErr } = await user.db
      .from("schedules")
      .select("id, enabled")
      .eq("id", params.id)
      .eq("user_id", user.userId)
      .maybeSingle();

    if (fetchErr !== null) {
      return respondError("internal", "Failed to load schedule", {
        traceId,
        details: { code: fetchErr.code },
      });
    }
    if (existing === null) {
      return respondError("not_found", "Schedule not found", { traceId });
    }

    const { data: updated, error: updateErr } = await user.db
      .from("schedules")
      .update({ enabled: !existing.enabled })
      .eq("id", params.id)
      .eq("user_id", user.userId)
      .select("*, plans(id, name)")
      .single();

    if (updateErr !== null || updated === null) {
      return respondError("internal", "Failed to toggle schedule", {
        traceId,
        details: updateErr ? { code: updateErr.code } : undefined,
      });
    }

    return respond(updated, { traceId });
  },
);

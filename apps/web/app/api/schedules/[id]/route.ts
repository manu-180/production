import { defineRoute, respond, respondError, respondNoContent } from "@/lib/api";
import { type ScheduleUpdate, scheduleUpdateSchema } from "@/lib/validators/schedules";
import { getNextRun, parseCron } from "@conductor/core";

export const dynamic = "force-dynamic";

interface Params {
  id: string;
}

/**
 * GET /api/schedules/:id — return a single schedule with plan info.
 */
export const GET = defineRoute<undefined, undefined, Params>(
  {},
  async ({ user, traceId, params }) => {
    const { data: schedule, error } = await user.db
      .from("schedules")
      .select("*, plans(id, name)")
      .eq("id", params.id)
      .eq("user_id", user.userId)
      .maybeSingle();

    if (error !== null) {
      return respondError("internal", "Failed to load schedule", {
        traceId,
        details: { code: error.code },
      });
    }
    if (schedule === null) {
      return respondError("not_found", "Schedule not found", { traceId });
    }

    return respond(schedule, { traceId });
  },
);

/**
 * PATCH /api/schedules/:id — partial update. Recomputes next_run_at when
 * cron_expression changes.
 */
export const PATCH = defineRoute<ScheduleUpdate, undefined, Params>(
  { rateLimit: "mutation", bodySchema: scheduleUpdateSchema },
  async ({ user, traceId, body, params }) => {
    const update: Record<string, unknown> = {};

    if (body.name !== undefined) update["name"] = body.name;
    if (body.plan_id !== undefined) update["plan_id"] = body.plan_id;
    if (body.enabled !== undefined) update["enabled"] = body.enabled;
    if (body.working_dir !== undefined) update["working_dir"] = body.working_dir;
    if (body.skip_if_running !== undefined) update["skip_if_running"] = body.skip_if_running;
    if (body.skip_if_recent_hours !== undefined)
      update["skip_if_recent_hours"] = body.skip_if_recent_hours;
    if (body.quiet_hours_start !== undefined) update["quiet_hours_start"] = body.quiet_hours_start;
    if (body.quiet_hours_end !== undefined) update["quiet_hours_end"] = body.quiet_hours_end;

    if (body.cron_expression !== undefined) {
      const parsed = parseCron(body.cron_expression);
      if (parsed instanceof Error) {
        return respondError("validation", `Invalid cron expression: ${parsed.message}`, {
          traceId,
        });
      }
      update["cron_expression"] = body.cron_expression;
      try {
        update["next_run_at"] = getNextRun(parsed, new Date()).toISOString();
      } catch {
        update["next_run_at"] = null;
      }
    }

    const { data: schedule, error } = await user.db
      .from("schedules")
      // biome-ignore lint/suspicious/noExplicitAny: structural update payload
      .update(update as any)
      .eq("id", params.id)
      .eq("user_id", user.userId)
      .select("*, plans(id, name)")
      .maybeSingle();

    if (error !== null) {
      return respondError("internal", "Failed to update schedule", {
        traceId,
        details: { code: error.code },
      });
    }
    if (schedule === null) {
      return respondError("not_found", "Schedule not found", { traceId });
    }

    return respond(schedule, { traceId });
  },
);

/**
 * DELETE /api/schedules/:id — hard delete.
 */
export const DELETE = defineRoute<undefined, undefined, Params>(
  { rateLimit: "mutation" },
  async ({ user, traceId, params }) => {
    const { data: existing, error: lookupErr } = await user.db
      .from("schedules")
      .select("id")
      .eq("id", params.id)
      .eq("user_id", user.userId)
      .maybeSingle();

    if (lookupErr !== null) {
      return respondError("internal", "Failed to look up schedule", {
        traceId,
        details: { code: lookupErr.code },
      });
    }
    if (existing === null) {
      return respondError("not_found", "Schedule not found", { traceId });
    }

    const { error: delErr } = await user.db.from("schedules").delete().eq("id", params.id);

    if (delErr !== null) {
      return respondError("internal", "Failed to delete schedule", {
        traceId,
        details: { code: delErr.code },
      });
    }

    return respondNoContent(traceId);
  },
);

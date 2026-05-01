import { defineRoute, respond, respondError } from "@/lib/api";
import { type ScheduleCreate, scheduleCreateSchema } from "@/lib/validators/schedules";
import { getNextRun, parseCron } from "@conductor/core";

export const dynamic = "force-dynamic";

/**
 * GET /api/schedules — list all schedules for the authenticated user.
 * Joins with plans to surface the plan name.
 */
export const GET = defineRoute({}, async ({ user, traceId }) => {
  const { data, error } = await user.db
    .from("schedules")
    .select("*, plans(id, name)")
    .eq("user_id", user.userId)
    .order("created_at", { ascending: false });

  if (error !== null) {
    return respondError("internal", "Failed to load schedules", {
      traceId,
      details: { code: error.code },
    });
  }

  return respond({ schedules: data ?? [] }, { traceId });
});

/**
 * POST /api/schedules — create a new schedule.
 * Computes next_run_at from the cron expression.
 */
export const POST = defineRoute<ScheduleCreate>(
  { rateLimit: "mutation", bodySchema: scheduleCreateSchema },
  async ({ user, traceId, body }) => {
    // Validate and compute next run time
    const parsed = parseCron(body.cron_expression);
    if (parsed instanceof Error) {
      return respondError("validation", `Invalid cron expression: ${parsed.message}`, { traceId });
    }

    let nextRunAt: string | null = null;
    try {
      nextRunAt = getNextRun(parsed, new Date()).toISOString();
    } catch {
      nextRunAt = null;
    }

    const { data: schedule, error } = await user.db
      .from("schedules")
      .insert({
        user_id: user.userId,
        plan_id: body.plan_id,
        name: body.name,
        cron_expression: body.cron_expression,
        enabled: true,
        working_dir: body.working_dir ?? null,
        skip_if_running: body.skip_if_running ?? false,
        skip_if_recent_hours: body.skip_if_recent_hours ?? null,
        quiet_hours_start: body.quiet_hours_start ?? null,
        quiet_hours_end: body.quiet_hours_end ?? null,
        next_run_at: nextRunAt,
      })
      .select("*, plans(id, name)")
      .single();

    if (error !== null || schedule === null) {
      return respondError("internal", "Failed to create schedule", {
        traceId,
        details: error ? { code: error.code } : undefined,
      });
    }

    return respond(schedule, { status: 201, traceId });
  },
);

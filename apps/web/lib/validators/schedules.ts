import { z } from "zod";

export const scheduleCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  plan_id: z.string().uuid(),
  cron_expression: z.string().min(9), // "* * * * *"
  working_dir: z.string().trim().max(2000).optional(),
  skip_if_running: z.boolean().default(false),
  skip_if_recent_hours: z.number().int().min(1).max(168).optional().nullable(),
  quiet_hours_start: z.number().int().min(0).max(23).optional().nullable(),
  quiet_hours_end: z.number().int().min(0).max(23).optional().nullable(),
});
export type ScheduleCreate = z.infer<typeof scheduleCreateSchema>;

export const scheduleUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    plan_id: z.string().uuid().optional(),
    cron_expression: z.string().min(9).optional(),
    working_dir: z.string().trim().max(2000).nullable().optional(),
    enabled: z.boolean().optional(),
    skip_if_running: z.boolean().optional(),
    skip_if_recent_hours: z.number().int().min(1).max(168).nullable().optional(),
    quiet_hours_start: z.number().int().min(0).max(23).nullable().optional(),
    quiet_hours_end: z.number().int().min(0).max(23).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });
export type ScheduleUpdate = z.infer<typeof scheduleUpdateSchema>;

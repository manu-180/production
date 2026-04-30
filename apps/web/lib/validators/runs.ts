import { z } from "zod";
import { paginationQuerySchema } from "./common";

export const RUN_STATUSES = [
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;
export const runStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof runStatusSchema>;

const reasonSchema = z.string().trim().max(2000);

export const runTriggerSchema = z.object({
  workingDir: z.string().trim().min(1).max(2000),
  settingsOverride: z.record(z.string(), z.unknown()).optional(),
  dryRun: z.boolean().optional(),
});
export type RunTrigger = z.infer<typeof runTriggerSchema>;

export const runListQuerySchema = paginationQuerySchema.extend({
  status: runStatusSchema.optional(),
  planId: z.string().uuid().optional(),
});
export type RunListQuery = z.infer<typeof runListQuerySchema>;

/**
 * Optional-reason body. Accepts `null`/`undefined`/missing JSON because POST
 * without a body is idiomatic for control endpoints (`POST /pause` etc.) and
 * we don't want to force the client to send `{}`.
 */
export const runReasonBodySchema = z.preprocess(
  (v) => (v === null || v === undefined ? {} : v),
  z.object({ reason: reasonSchema.optional() }),
);
export type RunReasonBody = z.infer<typeof runReasonBodySchema>;

export const runCancelSchema = z.object({
  reason: reasonSchema,
});
export type RunCancel = z.infer<typeof runCancelSchema>;

export const skipPromptSchema = z.object({
  promptId: z.string().uuid(),
  reason: reasonSchema.optional(),
});
export type SkipPrompt = z.infer<typeof skipPromptSchema>;

export const approvePromptSchema = z.object({
  promptId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  reason: reasonSchema.optional(),
});
export type ApprovePrompt = z.infer<typeof approvePromptSchema>;

export const rollbackSchema = z
  .object({
    toPromptId: z.string().uuid().optional(),
    toSha: z.string().min(7).max(40).optional(),
  })
  .refine((v) => v.toPromptId !== undefined || v.toSha !== undefined, {
    message: "either toPromptId or toSha is required",
  });
export type Rollback = z.infer<typeof rollbackSchema>;

export const decisionOverrideSchema = z.object({
  humanResponse: z.string().min(1).max(10_000),
  requeuePrompt: z.boolean(),
});
export type DecisionOverride = z.infer<typeof decisionOverrideSchema>;

export const logsQuerySchema = paginationQuerySchema.extend({
  promptId: z.string().uuid().optional(),
  channel: z.enum(["stdout", "stderr", "claude"]).optional(),
  stream: z.coerce.boolean().optional(),
});
export type LogsQuery = z.infer<typeof logsQuerySchema>;

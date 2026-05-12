import { z } from "zod";

export const tokenUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cache_creation_input_tokens: z.number().int().nonnegative().optional(),
    cache_read_input_tokens: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const contentBlockSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

export type ContentBlock = z.infer<typeof contentBlockSchema>;

export const userMessageContentSchema = z.union([z.string(), z.array(contentBlockSchema)]);

export const systemInitEventSchema = z
  .object({
    type: z.literal("system"),
    subtype: z.literal("init"),
    session_id: z.string(),
    tools: z.array(z.string()).default([]),
    // `cwd` and `model` are optional — older / patched Claude CLI versions
    // have been observed emitting `system.init` without them. We must NOT
    // reject the event in that case; the whole stream would then be parsed
    // as `parse_error` and the orchestrator would lose the session_id +
    // model hint, making subsequent runs unreliable (silent successes,
    // wrong cost math). Tolerating missing fields is forward/backward
    // compatible — present fields are still validated as strings.
    cwd: z.string().optional(),
    model: z.string().optional(),
  })
  .passthrough();

export type SystemInitEvent = z.infer<typeof systemInitEventSchema>;

export const userEventSchema = z
  .object({
    type: z.literal("user"),
    message: z
      .object({
        role: z.literal("user"),
        content: userMessageContentSchema,
      })
      .passthrough(),
  })
  .passthrough();

export type UserEvent = z.infer<typeof userEventSchema>;

export const assistantEventSchema = z
  .object({
    type: z.literal("assistant"),
    message: z
      .object({
        id: z.string(),
        role: z.literal("assistant"),
        content: z.array(contentBlockSchema),
        stop_reason: z.string().optional(),
        usage: tokenUsageSchema,
      })
      .passthrough(),
  })
  .passthrough();

export type AssistantEvent = z.infer<typeof assistantEventSchema>;

export const toolUseEventSchema = z
  .object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.unknown(),
  })
  .passthrough();

export type ToolUseEvent = z.infer<typeof toolUseEventSchema>;

export const toolResultEventSchema = z
  .object({
    type: z.literal("tool_result"),
    tool_use_id: z.string(),
    content: z.union([z.string(), z.array(contentBlockSchema)]),
    is_error: z.boolean().optional(),
  })
  .passthrough();

export type ToolResultEvent = z.infer<typeof toolResultEventSchema>;

export const resultEventSchema = z
  .object({
    type: z.literal("result"),
    subtype: z.string(),
    // `duration_ms` and `usage` are optional — Claude CLI error subtypes
    // (`error_max_turns`, `error_during_execution`, etc.) have been observed
    // emitting `result` events without them. Marking required here would
    // make the whole event parse-fail → orchestrator misses the error
    // payload entirely → silent "success" with no captured result. Token
    // usage falls back to assistant-event aggregation when missing.
    duration_ms: z.number().nonnegative().optional(),
    total_cost_usd: z.number().nonnegative().optional(),
    usage: tokenUsageSchema.optional(),
    result: z.string().optional(),
  })
  .passthrough();

export type ResultEvent = z.infer<typeof resultEventSchema>;

export const errorEventSchema = z
  .object({
    type: z.literal("error"),
    message: z.string(),
    code: z.string().optional(),
  })
  .passthrough();

export type ErrorEvent = z.infer<typeof errorEventSchema>;

export const parseErrorEventSchema = z.object({
  type: z.literal("parse_error"),
  raw: z.string(),
});

export type ParseErrorEvent = z.infer<typeof parseErrorEventSchema>;

export const claudeStreamEventSchema = z.discriminatedUnion("type", [
  systemInitEventSchema,
  userEventSchema,
  assistantEventSchema,
  toolUseEventSchema,
  toolResultEventSchema,
  resultEventSchema,
  errorEventSchema,
  parseErrorEventSchema,
]);

export type ClaudeStreamEvent = z.infer<typeof claudeStreamEventSchema>;

export function isSystemInitEvent(e: ClaudeStreamEvent): e is SystemInitEvent {
  return e.type === "system" && (e as SystemInitEvent).subtype === "init";
}

export function isResultEvent(e: ClaudeStreamEvent): e is ResultEvent {
  return e.type === "result";
}

export function isAssistantEvent(e: ClaudeStreamEvent): e is AssistantEvent {
  return e.type === "assistant";
}

export function isErrorEvent(e: ClaudeStreamEvent): e is ErrorEvent {
  return e.type === "error";
}

export function isParseErrorEvent(e: ClaudeStreamEvent): e is ParseErrorEvent {
  return e.type === "parse_error";
}

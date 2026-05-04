import { z } from "zod";

export const ALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
] as const;

export type AllowedTool = (typeof ALLOWED_TOOLS)[number];

const allowedToolSchema = z.enum(ALLOWED_TOOLS);

const permissionModeSchema = z.enum(["default", "acceptEdits", "bypassPermissions"]);

export const promptFrontmatterSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  continueSession: z.boolean().optional(),
  allowedTools: z.array(allowedToolSchema).optional(),
  permissionMode: permissionModeSchema.optional(),
  maxTurns: z.number().int().min(1).max(500).optional(),
  maxBudgetUsd: z.number().min(0.01).max(100).optional(),
  timeoutMs: z.number().int().min(1000).max(3_600_000).optional(),
  retries: z.number().int().min(0).max(10).optional(),
  requiresApproval: z.boolean().optional(),
  rollbackOnFail: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  dependsOn: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
});

export type PromptFrontmatter = z.infer<typeof promptFrontmatterSchema>;

export const defaultFrontmatter: PromptFrontmatter = {
  continueSession: false,
  allowedTools: ["Bash", "Read", "Edit", "Write", "Glob", "Grep"],
  permissionMode: "bypassPermissions",
  maxTurns: 50,
  requiresApproval: false,
  rollbackOnFail: false,
};

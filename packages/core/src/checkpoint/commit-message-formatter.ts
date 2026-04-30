/**
 * Conductor — CommitMessageFormatter
 *
 * Formats and parses structured commit messages for Conductor checkpoint
 * commits. Each checkpoint commit carries machine-readable metadata in the
 * commit body so that history can be replayed or inspected programmatically.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptCheckpointInfo {
  /** Short run ID like "abc12345" */
  runId: string;
  /** 1-based index */
  promptOrder: number;
  totalPrompts: number;
  promptTitle: string;
  promptFilename: string;
  executionId: string;
  toolsUsed: string[];
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  tokensCache: number;
  costUsd: number;
  guardianDecisions: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONDUCTOR_FOOTER = "🤖 Conductor automation";
const CONDUCTOR_PREFIX = "conductor(run-";

// ---------------------------------------------------------------------------
// formatCheckpointMessage
// ---------------------------------------------------------------------------

/**
 * Formats a PromptCheckpointInfo into a structured Conductor commit message.
 *
 * Format:
 * ```
 * conductor(run-{runId}): {promptOrder}/{totalPrompts} {promptTitle}
 *
 * Prompt: {promptFilename}
 * Execution-Id: {executionId}
 * Tools-Used: {tool1, tool2, ...}
 * Duration: {durationMs}ms
 * Tokens: in={tokensIn}, out={tokensOut}, cache={tokensCache}
 * Cost-Usd: {costUsd fixed to 6 decimals}
 * Guardian-Decisions: {guardianDecisions}
 *
 * 🤖 Conductor automation
 * ```
 */
export function formatCheckpointMessage(info: PromptCheckpointInfo): string {
  const toolsLine = info.toolsUsed.length > 0 ? info.toolsUsed.join(", ") : "(none)";

  const subject = `${CONDUCTOR_PREFIX}${info.runId}): ${info.promptOrder}/${info.totalPrompts} ${info.promptTitle}`;

  const body = [
    `Prompt: ${info.promptFilename}`,
    `Execution-Id: ${info.executionId}`,
    `Tools-Used: ${toolsLine}`,
    `Duration: ${info.durationMs}ms`,
    `Tokens: in=${info.tokensIn}, out=${info.tokensOut}, cache=${info.tokensCache}`,
    `Cost-Usd: ${info.costUsd.toFixed(6)}`,
    `Guardian-Decisions: ${info.guardianDecisions}`,
  ].join("\n");

  return `${subject}\n\n${body}\n\n${CONDUCTOR_FOOTER}`;
}

// ---------------------------------------------------------------------------
// parseCheckpointMessage
// ---------------------------------------------------------------------------

/**
 * Parses a Conductor checkpoint commit message back into a PromptCheckpointInfo.
 * Returns null if the message is not a valid Conductor checkpoint message.
 */
export function parseCheckpointMessage(commitMessage: string): PromptCheckpointInfo | null {
  if (!commitMessage.startsWith(CONDUCTOR_PREFIX)) {
    return null;
  }

  const lines = commitMessage.split("\n");

  // Parse subject line: conductor(run-{runId}): {promptOrder}/{totalPrompts} {promptTitle}
  const subjectLine = lines[0];
  if (subjectLine === undefined) return null;

  // Extract runId from "conductor(run-{runId}):"
  const runIdMatch = subjectLine.match(/^conductor\(run-([^)]+)\):\s/);
  if (!runIdMatch) return null;
  const runId = runIdMatch[1];
  if (runId === undefined) return null;

  // Extract the rest: "{promptOrder}/{totalPrompts} {promptTitle}"
  const afterPrefix = subjectLine.slice(`${CONDUCTOR_PREFIX}${runId}): `.length);
  const orderMatch = afterPrefix.match(/^(\d+)\/(\d+)\s+(.+)$/);
  if (!orderMatch) return null;

  const promptOrderStr = orderMatch[1];
  const totalPromptsStr = orderMatch[2];
  const promptTitle = orderMatch[3];

  if (promptOrderStr === undefined || totalPromptsStr === undefined || promptTitle === undefined) {
    return null;
  }

  const promptOrder = Number.parseInt(promptOrderStr, 10);
  const totalPrompts = Number.parseInt(totalPromptsStr, 10);

  // Build a map of header key -> value from body lines
  const headers = new Map<string, string>();
  for (const line of lines.slice(2)) {
    if (line === "" || line === CONDUCTOR_FOOTER) continue;
    const separatorIndex = line.indexOf(": ");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 2);
    headers.set(key, value);
  }

  const promptFilename = headers.get("Prompt");
  const executionId = headers.get("Execution-Id");
  const toolsUsedRaw = headers.get("Tools-Used");
  const durationRaw = headers.get("Duration");
  const tokensRaw = headers.get("Tokens");
  const costRaw = headers.get("Cost-Usd");
  const guardianRaw = headers.get("Guardian-Decisions");

  if (
    promptFilename === undefined ||
    executionId === undefined ||
    toolsUsedRaw === undefined ||
    durationRaw === undefined ||
    tokensRaw === undefined ||
    costRaw === undefined ||
    guardianRaw === undefined
  ) {
    return null;
  }

  // Parse Tools-Used
  const toolsUsed =
    toolsUsedRaw === "(none)" ? [] : toolsUsedRaw.split(", ").filter((t) => t.length > 0);

  // Parse Duration: "{durationMs}ms"
  const durationMatch = durationRaw.match(/^(\d+)ms$/);
  if (!durationMatch) return null;
  const durationMsStr = durationMatch[1];
  if (durationMsStr === undefined) return null;
  const durationMs = Number.parseInt(durationMsStr, 10);

  // Parse Tokens: "in={tokensIn}, out={tokensOut}, cache={tokensCache}"
  const tokensMatch = tokensRaw.match(/^in=(\d+), out=(\d+), cache=(\d+)$/);
  if (!tokensMatch) return null;

  const tokensInStr = tokensMatch[1];
  const tokensOutStr = tokensMatch[2];
  const tokensCacheStr = tokensMatch[3];

  if (tokensInStr === undefined || tokensOutStr === undefined || tokensCacheStr === undefined) {
    return null;
  }

  const tokensIn = Number.parseInt(tokensInStr, 10);
  const tokensOut = Number.parseInt(tokensOutStr, 10);
  const tokensCache = Number.parseInt(tokensCacheStr, 10);

  // Parse Cost-Usd
  const costUsd = Number.parseFloat(costRaw);
  if (Number.isNaN(costUsd)) return null;

  // Parse Guardian-Decisions
  const guardianDecisions = Number.parseInt(guardianRaw, 10);
  if (Number.isNaN(guardianDecisions)) return null;

  return {
    runId,
    promptOrder,
    totalPrompts,
    promptTitle,
    promptFilename,
    executionId,
    toolsUsed,
    durationMs,
    tokensIn,
    tokensOut,
    tokensCache,
    costUsd,
    guardianDecisions,
  };
}

// ---------------------------------------------------------------------------
// formatNoChangesMessage
// ---------------------------------------------------------------------------

/**
 * Formats a "no changes" commit message for when a prompt made no file
 * modifications.
 *
 * Format:
 * ```
 * conductor(run-{runId}): {promptOrder} {promptTitle} [no changes]
 *
 * No files were modified by this prompt.
 *
 * 🤖 Conductor automation
 * ```
 */
export function formatNoChangesMessage(
  runId: string,
  promptOrder: number,
  promptTitle: string,
): string {
  const subject = `${CONDUCTOR_PREFIX}${runId}): ${promptOrder} ${promptTitle} [no changes]`;
  return `${subject}\n\nNo files were modified by this prompt.\n\n${CONDUCTOR_FOOTER}`;
}

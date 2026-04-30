/**
 * Stable, predictable channel names so server-side payload publishers and
 * client-side subscribers stay in sync.
 */
export const channels = {
  runEvents: (runId: string) => `run-events:${runId}`,
  outputChunks: (promptExecutionId: string) => `output-chunks:${promptExecutionId}`,
  runSummary: (userId: string) => `run-summary:${userId}`,
} as const;

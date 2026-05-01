import type { NotificationEvent } from "../types.js";

export function formatTitle(event: NotificationEvent): string {
  switch (event.type) {
    case "run.completed":
      return event.success ? "✓ Run Completed" : "✗ Run Completed (with errors)";
    case "run.failed":
      return "✗ Run Failed";
    case "auth.invalid":
      return "⚠ Auth Token Invalid";
    case "circuit.open":
      return "⚠ Circuit Breaker Opened";
    case "rate_limit.long":
      return "⏳ Rate Limit — Long Wait";
    case "approval.required":
      return "👋 Approval Required";
    case "cost.threshold":
      return "💰 Cost Threshold Reached";
  }
}

export function formatBody(event: NotificationEvent): string {
  switch (event.type) {
    case "run.completed": {
      const duration = formatDuration(event.durationMs);
      const cost = event.costUsd.toFixed(4);
      return `Plan <b>${event.planName}</b> finished in ${duration} · Cost: $${cost}`;
    }
    case "run.failed":
      return `Plan <b>${event.planName}</b> failed: ${event.reason}`;
    case "auth.invalid":
      return "Your Claude OAuth token is no longer valid. Re-authenticate in Settings.";
    case "circuit.open":
      return `The circuit breaker for plan <b>${event.planName}</b> has opened due to repeated failures. Run ${event.runId} is paused.`;
    case "rate_limit.long":
      return `A rate limit requires waiting ${event.waitSeconds}s before the next attempt. The run will resume automatically.`;
    case "approval.required":
      return `Plan <b>${event.planName}</b> is waiting for human approval on prompt ${event.promptId}. Visit the dashboard to respond.`;
    case "cost.threshold":
      return `Monthly spend has reached $${event.monthlyUsd.toFixed(2)}, exceeding your threshold of $${event.thresholdUsd.toFixed(2)}.`;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

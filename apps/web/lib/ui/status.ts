/** Centralized status → tone/label/pulse mapping. Used by badges, timeline, headers. */

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";
export type RunStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";
export type ExecutionStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "rolled_back"
  | "awaiting_approval";

export interface StatusInfo {
  label: string;
  tone: StatusTone;
  pulse: boolean;
}

export function runStatusInfo(status: RunStatus): StatusInfo {
  switch (status) {
    case "queued":
      return { label: "Queued", tone: "neutral", pulse: false };
    case "running":
      return { label: "Running", tone: "info", pulse: true };
    case "paused":
      return { label: "Paused", tone: "warning", pulse: false };
    case "completed":
      return { label: "Completed", tone: "success", pulse: false };
    case "failed":
      return { label: "Failed", tone: "danger", pulse: false };
    case "cancelled":
      return { label: "Cancelled", tone: "danger", pulse: false };
    default: {
      const _exhaustive: never = status;
      return { label: String(_exhaustive), tone: "neutral", pulse: false };
    }
  }
}

export function executionStatusInfo(status: ExecutionStatus): StatusInfo {
  switch (status) {
    case "pending":
      return { label: "Pending", tone: "neutral", pulse: false };
    case "running":
      return { label: "Running", tone: "info", pulse: true };
    case "succeeded":
      return { label: "Succeeded", tone: "success", pulse: false };
    case "failed":
      return { label: "Failed", tone: "danger", pulse: false };
    case "skipped":
      return { label: "Skipped", tone: "neutral", pulse: false };
    case "rolled_back":
      return { label: "Rolled back", tone: "warning", pulse: false };
    case "awaiting_approval":
      return { label: "Awaiting approval", tone: "warning", pulse: true };
    default: {
      const _exhaustive: never = status;
      return { label: String(_exhaustive), tone: "neutral", pulse: false };
    }
  }
}

/** Tailwind utility tokens per tone. Centralized so badges/dots/borders agree. */
export const TONE_CLASSES: Record<
  StatusTone,
  { dot: string; bg: string; text: string; border: string }
> = {
  neutral: {
    dot: "bg-muted-foreground",
    bg: "bg-muted",
    text: "text-muted-foreground",
    border: "border-border",
  },
  info: {
    dot: "bg-sky-500",
    bg: "bg-sky-500/10",
    text: "text-sky-600 dark:text-sky-300",
    border: "border-sky-500/30",
  },
  success: {
    dot: "bg-emerald-500",
    bg: "bg-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-300",
    border: "border-emerald-500/30",
  },
  warning: {
    dot: "bg-amber-500",
    bg: "bg-amber-500/10",
    text: "text-amber-600 dark:text-amber-300",
    border: "border-amber-500/30",
  },
  danger: {
    dot: "bg-rose-500",
    bg: "bg-rose-500/10",
    text: "text-rose-600 dark:text-rose-300",
    border: "border-rose-500/30",
  },
};

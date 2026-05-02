/** Returns an ISO date string (YYYY-MM-DD) for N days ago (UTC). */
export function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Formats a USD cost for display in the insights UI.
 * Shows "$0.00" for zero, "< $0.01" for sub-cent values, otherwise 2 decimals.
 */
export function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return "< $0.01";
  return `$${value.toFixed(2)}`;
}

/** Formats a token count: `842`, `12.3k`, `2.5M`. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Formats USD: 4 decimals below $1, 2 above. */
export function formatCostUsd(n: number): string {
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/** Formats a duration in ms as the largest two units: `45s`, `2m 5s`, `1h 2m`. */
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 10) return "justo ahora";
  if (sec < 60) return `hace ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr}h`;
  return `hace ${Math.floor(hr / 24)}d`;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  let i = 0;
  let value = n;
  while (value >= 1024 && i < BYTE_UNITS.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${BYTE_UNITS[i]}`;
}

/**
 * Conductor — JSON Exporter
 *
 * Two export formats:
 *   - `toJson`  — pretty-printed JSON array
 *   - `toJsonL` — JSON Lines (one object per line, no wrapping array)
 */

/**
 * Serialises rows to a pretty-printed JSON array string.
 */
export function toJson<T>(rows: T[]): string {
  return JSON.stringify(rows, null, 2);
}

/**
 * Serialises rows to JSON Lines format (NDJSON): one compact JSON object per
 * line. Useful for large exports that are streamed or processed line-by-line.
 */
export function toJsonL<T>(rows: T[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n");
}

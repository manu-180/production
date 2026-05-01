/**
 * Conductor — CSV Exporter
 *
 * Pure TypeScript RFC 4180-compliant CSV serialiser.
 * No external dependencies.
 */

/**
 * Serialises an array of objects to a CSV string.
 *
 * @param rows    - Array of objects to serialise. Returns `""` if empty.
 * @param columns - Optional subset of keys to include, in desired order.
 *                  When omitted, all keys from the first row are used.
 */
export function toCsv<T extends Record<string, unknown>>(rows: T[], columns?: (keyof T)[]): string {
  if (rows.length === 0) return "";

  const keys: (keyof T)[] =
    columns !== undefined && columns.length > 0
      ? columns
      : (Object.keys(rows[0] as object) as (keyof T)[]);

  const header = keys.map((k) => escapeCell(String(k))).join(",");

  const dataLines = rows.map((row) => keys.map((k) => escapeCell(cellValue(row[k]))).join(","));

  return [header, ...dataLines].join("\r\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a cell value to a string. Null/undefined become empty string.
 */
function cellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * RFC 4180 escaping:
 *  - Fields containing commas, double-quotes, or newlines must be wrapped in
 *    double-quotes.
 *  - Double-quote characters within fields are escaped by doubling them.
 */
function escapeCell(value: string): string {
  const needsQuoting = /[",\r\n]/.test(value);
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Conductor — Cron Parser
 *
 * Minimal 5-field standard cron expression parser. No external dependencies.
 *
 * Field order: minute  hour  day-of-month  month  day-of-week
 * Ranges:      0-59    0-23  1-31          1-12   0-6  (0 = Sunday)
 *
 * Supported syntax per field:
 *   *          — every value
 *   5          — specific value
 *   1-5        — range (inclusive)
 *   1,3,5      — list of values
 *   *\/15       — step over the full range
 *   0-30\/5     — step over a sub-range
 *   Lists and ranges can be combined: 1,3,10-15
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A pre-parsed cron expression: each field is an ordered set of valid values. */
export interface CronExpression {
  /** Valid minute values (0–59). */
  minutes: ReadonlySet<number>;
  /** Valid hour values (0–23). */
  hours: ReadonlySet<number>;
  /** Valid day-of-month values (1–31). */
  daysOfMonth: ReadonlySet<number>;
  /** Valid month values (1–12). */
  months: ReadonlySet<number>;
  /** Valid day-of-week values (0–6, Sunday = 0). */
  daysOfWeek: ReadonlySet<number>;
  /** The original expression string (for error messages / logging). */
  raw: string;
}

interface FieldSpec {
  name: string;
  min: number;
  max: number;
}

const FIELD_SPECS: [FieldSpec, FieldSpec, FieldSpec, FieldSpec, FieldSpec] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 6 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Field parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Expand a single cron field token into the set of integers it represents.
 * Returns an Error string on invalid input.
 */
function expandToken(token: string, spec: FieldSpec): number[] | string {
  const { min, max, name } = spec;

  // step syntax: base/step  where base is * or range
  const slashIdx = token.indexOf("/");
  if (slashIdx !== -1) {
    const basePart = token.slice(0, slashIdx);
    const stepStr = token.slice(slashIdx + 1);
    const step = Number.parseInt(stepStr, 10);
    if (Number.isNaN(step) || step <= 0) {
      return `${name}: invalid step "${stepStr}"`;
    }

    let rangeMin = min;
    let rangeMax = max;

    if (basePart !== "*") {
      const dashIdx = basePart.indexOf("-");
      if (dashIdx === -1) {
        return `${name}: step base must be * or a range, got "${basePart}"`;
      }
      const lo = Number.parseInt(basePart.slice(0, dashIdx), 10);
      const hi = Number.parseInt(basePart.slice(dashIdx + 1), 10);
      if (Number.isNaN(lo) || Number.isNaN(hi) || lo < min || hi > max || lo > hi) {
        return `${name}: invalid range "${basePart}"`;
      }
      rangeMin = lo;
      rangeMax = hi;
    }

    const values: number[] = [];
    for (let v = rangeMin; v <= rangeMax; v += step) {
      values.push(v);
    }
    return values;
  }

  // wildcard
  if (token === "*") {
    const values: number[] = [];
    for (let v = min; v <= max; v++) {
      values.push(v);
    }
    return values;
  }

  // range: lo-hi
  const dashIdx = token.indexOf("-");
  if (dashIdx !== -1) {
    const lo = Number.parseInt(token.slice(0, dashIdx), 10);
    const hi = Number.parseInt(token.slice(dashIdx + 1), 10);
    if (Number.isNaN(lo) || Number.isNaN(hi)) {
      return `${name}: non-numeric range "${token}"`;
    }
    if (lo < min || hi > max || lo > hi) {
      return `${name}: range "${token}" out of bounds [${min}-${max}]`;
    }
    const values: number[] = [];
    for (let v = lo; v <= hi; v++) {
      values.push(v);
    }
    return values;
  }

  // specific value
  const n = Number.parseInt(token, 10);
  if (Number.isNaN(n)) {
    return `${name}: non-numeric value "${token}"`;
  }
  if (n < min || n > max) {
    return `${name}: value ${n} out of bounds [${min}-${max}]`;
  }
  return [n];
}

/**
 * Parse a full cron field (may be a comma-separated list of tokens) into a set.
 */
function parseField(field: string, spec: FieldSpec): Set<number> | string {
  const tokens = field.split(",");
  const result = new Set<number>();

  for (const token of tokens) {
    const expanded = expandToken(token.trim(), spec);
    if (typeof expanded === "string") return expanded; // propagate error
    for (const v of expanded) {
      result.add(v);
    }
  }

  if (result.size === 0) {
    return `${spec.name}: empty field "${field}"`;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse and validate a 5-field cron expression.
 *
 * @returns A {@link CronExpression} on success, or an `Error` describing the
 *          first problem found.
 *
 * @example
 * parseCron("*\/5 * * * *")  // every 5 minutes
 * parseCron("0 9 * * 1-5")  // 9 am on weekdays
 */
export function parseCron(expr: string): CronExpression | Error {
  const trimmed = expr.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length !== 5) {
    return new Error(
      `cron expression must have exactly 5 fields (got ${parts.length}): "${trimmed}"`,
    );
  }

  const [minutePart, hourPart, domPart, monthPart, dowPart] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  const minutes = parseField(minutePart, FIELD_SPECS[0]);
  if (typeof minutes === "string") return new Error(minutes);

  const hours = parseField(hourPart, FIELD_SPECS[1]);
  if (typeof hours === "string") return new Error(hours);

  const daysOfMonth = parseField(domPart, FIELD_SPECS[2]);
  if (typeof daysOfMonth === "string") return new Error(daysOfMonth);

  const months = parseField(monthPart, FIELD_SPECS[3]);
  if (typeof months === "string") return new Error(months);

  const daysOfWeek = parseField(dowPart, FIELD_SPECS[4]);
  if (typeof daysOfWeek === "string") return new Error(daysOfWeek);

  return { minutes, hours, daysOfMonth, months, daysOfWeek, raw: trimmed };
}

/**
 * Returns `true` if `expr` is a valid 5-field cron expression.
 */
export function isValidCron(expr: string): boolean {
  const result = parseCron(expr);
  return !(result instanceof Error);
}

/**
 * Compute the next execution time for a parsed cron expression after `from`.
 *
 * All field comparisons are performed in **UTC** so that the results are
 * deterministic regardless of the server's local timezone. Callers that need
 * timezone-aware scheduling should convert `from` to UTC themselves or apply
 * a UTC offset before calling this function.
 *
 * Algorithm: brute-force minute-by-minute forward scan. Simple, correct, and
 * fast enough for the scheduler tick cadence (called at most a few dozen times
 * per tick, not in a hot path).
 *
 * @throws Error if no valid time is found within one year (malformed expression
 *         that matches nothing, e.g. Feb 31).
 */
export function getNextRun(expr: CronExpression, from: Date): Date {
  // Work in UTC milliseconds to avoid local-timezone offsets.
  // Round up to the start of the next whole minute.
  const fromMs = from.getTime();
  const startMs = Math.floor(fromMs / 60_000) * 60_000 + 60_000;

  const limitMs = startMs + 365 * 24 * 60 * 60 * 1000; // one year ahead

  let cursor = startMs;

  while (cursor < limitMs) {
    const d = new Date(cursor);

    // All fields checked in UTC.
    const utcMonth = d.getUTCMonth() + 1; // 1-based
    if (!expr.months.has(utcMonth)) {
      // Skip to the first minute of the first day of the next UTC month.
      const next = new Date(0);
      next.setUTCFullYear(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      next.setUTCHours(0, 0, 0, 0);
      cursor = next.getTime();
      continue;
    }

    const utcDom = d.getUTCDate(); // 1-based
    const utcDow = d.getUTCDay(); // 0=Sunday
    if (!expr.daysOfMonth.has(utcDom) || !expr.daysOfWeek.has(utcDow)) {
      // Advance to the next UTC day at midnight.
      const next = new Date(0);
      next.setUTCFullYear(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
      next.setUTCHours(0, 0, 0, 0);
      cursor = next.getTime();
      continue;
    }

    const utcHour = d.getUTCHours();
    if (!expr.hours.has(utcHour)) {
      // Advance to the next UTC hour.
      const next = new Date(cursor);
      next.setUTCHours(utcHour + 1, 0, 0, 0);
      cursor = next.getTime();
      continue;
    }

    const utcMinute = d.getUTCMinutes();
    if (!expr.minutes.has(utcMinute)) {
      // Advance by one minute.
      cursor += 60_000;
      continue;
    }

    // All fields match — found it.
    return new Date(cursor);
  }

  throw new Error(`getNextRun: no valid execution time found within one year for "${expr.raw}"`);
}

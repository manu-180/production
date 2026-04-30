import { type PageCursor, decodeCursor, encodeCursor } from "@/lib/validators/common";

interface RowWithKey {
  id: string;
  created_at: string;
}

/**
 * Apply a `(created_at, id)` keyset filter to a Supabase select chain so it
 * returns rows strictly older than the cursor. Pairs with ORDER BY
 * (created_at DESC, id DESC).
 *
 * Postgres supports row constructor `< ($1, $2)`, but the Supabase JS client
 * doesn't expose that directly. We approximate with:
 *   WHERE created_at <= $cursor_created_at
 *   AND  (created_at < $cursor_created_at OR id < $cursor_id)
 * which is equivalent for distinct (created_at, id) pairs.
 */
export function applyCursorFilter<T>(
  query: T,
  cursorRaw: string | undefined,
): { query: T; cursor: PageCursor | null } {
  if (cursorRaw === undefined) return { query, cursor: null };
  const cursor = decodeCursor(cursorRaw);
  if (cursor === null) return { query, cursor: null };

  // Supabase's `or()` accepts a comma-separated PostgREST filter expression.
  // Both branches together preserve the strict-less-than semantics.
  // biome-ignore lint/suspicious/noExplicitAny: structural Supabase chain typing
  const q = query as any;
  const filtered = q
    .lte("created_at", cursor.createdAt)
    .or(`created_at.lt.${cursor.createdAt},id.lt.${cursor.id}`);

  return { query: filtered as T, cursor };
}

/**
 * Build the `nextCursor` for a list response: returns the cursor for the last
 * row when the page is full, otherwise undefined (no more rows).
 */
export function buildNextCursor(rows: RowWithKey[], limit: number): string | undefined {
  if (rows.length < limit) return undefined;
  const last = rows[rows.length - 1];
  if (last === undefined) return undefined;
  return encodeCursor({ createdAt: last.created_at, id: last.id });
}

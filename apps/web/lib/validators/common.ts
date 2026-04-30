import { z } from "zod";

/** UUID v4/v5/etc — Postgres uuid type, lenient form. */
export const uuidSchema = z.string().uuid();

/** Cursor used by paginated list endpoints (opaque, base64-encoded id). */
export const cursorSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9+/=_-]+$/, "cursor must be base64url-safe");

/** Standard pagination params for list endpoints. */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: cursorSchema.optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Cursor encoding for keyset pagination.
 *
 * Cursors are opaque to clients. We encode the last row's `(created_at, id)`
 * tuple base64url'd. Pagination queries use `created_at` as the primary key
 * with `id` as tiebreaker, matching ORDER BY (created_at DESC, id DESC).
 */
export interface PageCursor {
  createdAt: string; // ISO timestamp
  id: string; // UUID
}

export function encodeCursor(c: PageCursor): string {
  return Buffer.from(`${c.createdAt}|${c.id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): PageCursor | null {
  if (cursor === undefined) return null;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const idx = decoded.lastIndexOf("|");
    if (idx <= 0 || idx === decoded.length - 1) return null;
    const createdAt = decoded.slice(0, idx);
    const id = decoded.slice(idx + 1);
    if (createdAt.length === 0 || id.length === 0) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

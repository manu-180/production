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

/** Encode a row id into an opaque cursor. */
export function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

/** Decode a cursor back to a row id. Returns null on malformed input. */
export function decodeCursor(cursor: string | undefined): string | null {
  if (cursor === undefined) return null;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

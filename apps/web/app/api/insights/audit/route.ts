import { defineRoute, respond, respondError } from "@/lib/api";
import { toCsv } from "@conductor/core";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIT_ACTORS = ["user", "worker", "guardian", "system"] as const;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  page: z.coerce.number().int().min(0).default(0),
  actor: z.enum(AUDIT_ACTORS).optional(),
  action: z.string().max(64).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  resource_type: z.string().max(64).optional(),
  q: z.string().max(200).optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

type AuditQuery = z.infer<typeof querySchema>;

const CSV_COLUMNS = [
  "id",
  "created_at",
  "actor",
  "action",
  "resource_type",
  "resource_id",
  "user_id",
] as const;

/**
 * GET /api/insights/audit — paginated audit log with filters.
 *
 * Query params:
 *   limit, page       — pagination (default 50/0)
 *   actor             — filter by actor type
 *   action            — filter by exact action name
 *   from / to         — date range (YYYY-MM-DD, inclusive)
 *   resource_type     — filter by resource type
 *   q                 — full-text search across action/resource_type/resource_id
 *   format            — "json" (default) | "csv" (downloads up to 1 000 rows)
 */
export const GET = defineRoute<undefined, AuditQuery>(
  { querySchema },
  async ({ user, traceId, query }) => {
    const { limit, page, actor, action, from, to, resource_type, q, format } = query;

    const isCsv = format === "csv";
    const fetchLimit = isCsv ? 1000 : limit;
    const offset = isCsv ? 0 : page * limit;

    // biome-ignore lint/suspicious/noExplicitAny: audit_log may not yet be in generated types
    let dbQuery = (user.db.from as any)("audit_log")
      .select("id, user_id, actor, action, resource_type, resource_id, metadata, created_at", {
        count: "exact",
      })
      .eq("user_id", user.userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + fetchLimit - 1);

    if (actor !== undefined) dbQuery = dbQuery.eq("actor", actor);
    if (action !== undefined) dbQuery = dbQuery.eq("action", action);
    if (from !== undefined) dbQuery = dbQuery.gte("created_at", `${from}T00:00:00Z`);
    if (to !== undefined) dbQuery = dbQuery.lte("created_at", `${to}T23:59:59Z`);
    if (resource_type !== undefined) dbQuery = dbQuery.eq("resource_type", resource_type);

    if (q !== undefined && q.trim().length > 0) {
      // Whitelist-sanitize: keep only chars safe to embed in a PostgREST or() value.
      // Commas/parens would break the filter-string grammar; other specials are
      // harmless inside ilike values but stripping them avoids future surprises.
      const safeQ = q.replace(/[^a-zA-Z0-9\s._-]/g, "").trim();
      if (safeQ.length > 0) {
        const pattern = `%${safeQ}%`;
        dbQuery = dbQuery.or(
          `action.ilike.${pattern},resource_type.ilike.${pattern},resource_id.ilike.${pattern}`,
        );
      }
    }

    const { data, error, count } = await dbQuery;

    if (error !== null) {
      return respondError("internal", "Failed to load audit log", {
        traceId,
        details: process.env["NODE_ENV"] === "development" ? { code: error.code } : undefined,
      });
    }

    const rows: Record<string, unknown>[] = (data as Record<string, unknown>[]) ?? [];

    if (isCsv) {
      const csv = toCsv(rows, CSV_COLUMNS as unknown as (keyof Record<string, unknown>)[]);
      const totalCount = (count as number | null) ?? 0;
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
          "x-trace-id": traceId,
          // Let clients detect truncation when total > 1000
          "x-total-count": String(totalCount),
          "x-exported-count": String(rows.length),
        },
      });
    }

    const total = (count as number | null) ?? 0;
    const hasMore = offset + rows.length < total;

    return respond({ entries: rows, total, page, hasMore }, { traceId });
  },
);

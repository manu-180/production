import { createLogger } from "@conductor/core";
import type { NextRequest, NextResponse } from "next/server";
import type { ZodType } from "zod";
import { type AuthedUser, getAuthedUser } from "./auth";
import { type RateLimitTier, pickLimiter } from "./rate-limit";
import { respondError } from "./respond";
import { TRACE_ID_HEADER, resolveTraceId } from "./trace";

const log = createLogger("api");

export interface RouteContext<
  TBody = undefined,
  TQuery = undefined,
  TParams = Record<string, never>,
> {
  req: NextRequest;
  user: AuthedUser;
  traceId: string;
  body: TBody;
  query: TQuery;
  params: TParams;
}

interface DefineRouteOptions<TBody, TQuery> {
  /** Default `true`. Set `false` for public endpoints (eg. /system/health). */
  auth?: boolean;
  /** Default `"general"`. Use `"mutation"` for write endpoints, `"stream"` for SSE, `"none"` to disable. */
  rateLimit?: RateLimitTier;
  /** Validate `await req.json()`. Reject with 400 on parse failure. */
  bodySchema?: ZodType<TBody>;
  /** Validate `req.nextUrl.searchParams`. Reject with 400 on parse failure. */
  querySchema?: ZodType<TQuery>;
}

type Handler<TBody, TQuery, TParams> = (
  ctx: RouteContext<TBody, TQuery, TParams>,
) => Promise<NextResponse>;

type NextRouteContext<TParams> = {
  params: Promise<TParams>;
};

/**
 * Wrap a route handler with auth, rate-limiting, validation, traceId and
 * uniform error responses. Routes only express what's specific to them
 * (schema, business logic) — boilerplate lives here.
 *
 * Conventions:
 * - On any thrown error, returns 500 `{ error: "internal", traceId, message }` and logs the cause server-side.
 * - On schema violation, returns 400 `{ error: "validation", details: ZodIssue[] }`.
 * - On rate limit, returns 429 with `Retry-After` header.
 * - Always sets `x-trace-id` on the response.
 */
export function defineRoute<TBody = undefined, TQuery = undefined, TParams = Record<string, never>>(
  options: DefineRouteOptions<TBody, TQuery>,
  handler: Handler<TBody, TQuery, TParams>,
): (req: NextRequest, ctx?: NextRouteContext<TParams>) => Promise<NextResponse> {
  return async (req, ctx) => {
    const traceId = resolveTraceId(req);
    const reqId = traceId.slice(0, 8);
    const path = req.nextUrl.pathname;
    const method = req.method;

    try {
      // ── Auth ─────────────────────────────────────────────────────────────
      const wantsAuth = options.auth !== false;
      let user: AuthedUser | null = null;

      if (wantsAuth) {
        const auth = await getAuthedUser(req);
        if (!auth.ok) {
          const code = auth.reason === "forbidden" ? "forbidden" : "unauthorized";
          return respondError(code, "Authentication required", { traceId });
        }
        user = auth.user;
      }

      // ── Rate limit ───────────────────────────────────────────────────────
      const tier: RateLimitTier = options.rateLimit ?? "general";
      const limiter = pickLimiter(tier);
      if (limiter !== null && user !== null) {
        const result = limiter.check(`${tier}:${user.userId}`);
        if (!result.allowed) {
          const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
          return respondError("rate_limited", "Too many requests", {
            traceId,
            details: { retryAfterSec, resetAt: new Date(result.resetAt).toISOString() },
            headers: { "Retry-After": String(retryAfterSec) },
          });
        }
      }

      // ── Resolve params ───────────────────────────────────────────────────
      const params = (ctx?.params ? await ctx.params : ({} as TParams)) as TParams;

      // ── Body validation ──────────────────────────────────────────────────
      let body: TBody = undefined as TBody;
      if (options.bodySchema !== undefined) {
        const raw = await readJsonSafe(req);
        const parsed = options.bodySchema.safeParse(raw);
        if (!parsed.success) {
          return respondError("validation", "Invalid request body", {
            traceId,
            details: parsed.error.issues,
          });
        }
        body = parsed.data;
      }

      // ── Query validation ─────────────────────────────────────────────────
      let query: TQuery = undefined as TQuery;
      if (options.querySchema !== undefined) {
        const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
        const parsed = options.querySchema.safeParse(raw);
        if (!parsed.success) {
          return respondError("validation", "Invalid query parameters", {
            traceId,
            details: parsed.error.issues,
          });
        }
        query = parsed.data;
      }

      // ── Handler ──────────────────────────────────────────────────────────
      log.debug({ reqId, method, path, userId: user?.userId }, "api.request");

      const res = await handler({
        req,
        user: user as AuthedUser,
        traceId,
        body,
        query,
        params,
      });

      // Ensure traceId leaks back even if handler built the response by hand.
      if (!res.headers.has(TRACE_ID_HEADER)) {
        res.headers.set(TRACE_ID_HEADER, traceId);
      }
      return res;
    } catch (err) {
      log.error({ reqId, method, path, err }, "api.unhandled_error");
      return respondError("internal", "Internal server error", {
        traceId,
        details:
          process.env["NODE_ENV"] === "development"
            ? { cause: err instanceof Error ? err.message : String(err) }
            : undefined,
      });
    }
  };
}

async function readJsonSafe(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

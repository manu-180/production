import { NextResponse, type NextRequest } from "next/server";

/**
 * Dev-mode passthrough. We deliberately don't enforce auth here —
 * `getAuthedUser` returns DEV_USER_ID until multi-user lands.
 *
 * We don't mint a traceId here — that's resolveTraceId()'s job in
 * route handlers. This middleware exists as a hook for future auth
 * gates and is intentionally near-empty.
 *
 * If you ever need to mint UUIDs here, use `crypto.randomUUID()`
 * (Web Crypto API, available in edge runtime). DO NOT import from
 * `node:crypto` — that breaks the edge runtime.
 */
export function middleware(_req: NextRequest): NextResponse {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

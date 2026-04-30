import { type ServiceClient, createServiceClient } from "@conductor/db";

/**
 * Hardcoded user used while we operate in single-user dev mode.
 * The Fase 04 README and `apps/web/app/api/auth/claude-token/route.ts`
 * follow the same pattern. Swap to `supabase.auth.getUser()` when
 * multi-user auth lands.
 */
const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

export interface AuthedUser {
  userId: string;
  /** Service-role Supabase client. Bypasses RLS — only ever instantiated server-side. */
  db: ServiceClient;
}

export type AuthResult =
  | { ok: true; user: AuthedUser }
  | { ok: false; reason: "unauthorized" | "forbidden" };

/**
 * Resolve the authenticated user for a route.
 *
 * Today: returns the dev user unconditionally (single-user mode).
 * Tomorrow (Supabase Auth flow): read the cookie session, call
 * `supabase.auth.getUser()`, and reject when the user is missing.
 *
 * The shape is stable so route handlers don't need to change.
 */
export async function getAuthedUser(_req?: Request): Promise<AuthResult> {
  return {
    ok: true,
    user: {
      userId: DEV_USER_ID,
      db: createServiceClient(),
    },
  };
}

export const DEV_USER_ID_FALLBACK = DEV_USER_ID;

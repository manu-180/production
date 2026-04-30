import { defineRoute, respond, respondError, respondNoContent } from "@/lib/api";
import { createProductionTokenManager, validateToken } from "@conductor/core";
import { z } from "zod";

export const dynamic = "force-dynamic";

// Single-user dev mode mirrors `lib/api/auth.ts`. Swap to
// `supabase.auth.getUser()` when multi-user auth lands; the routes below stop
// being `auth: false` at that point.
const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

const tokenBodySchema = z.object({
  token: z.string().trim().min(1, "token is required and must be a non-empty string"),
});
type TokenBody = z.infer<typeof tokenBodySchema>;

/**
 * POST /api/auth/claude-token — onboarding-time token validation + persist.
 *
 * Auth is intentionally `false`: this endpoint is how the user proves they
 * have a valid Claude OAuth token in the first place, before any other
 * authenticated route works. Rate-limited under the mutation tier so a
 * brute-force token check still backs off.
 */
export const POST = defineRoute<TokenBody>(
  { auth: false, rateLimit: "mutation", bodySchema: tokenBodySchema },
  async ({ traceId, body }) => {
    const result = await validateToken(body.token);
    if (!result.valid) {
      return respondError("validation", "Token validation failed", { traceId });
    }
    const mgr = await createProductionTokenManager();
    await mgr.saveToken(DEV_USER_ID, body.token);
    return respond({ ok: true, validatedAt: new Date().toISOString() }, { traceId });
  },
);

/**
 * GET /api/auth/claude-token — does a token already exist for the dev user?
 * Public for the same reason POST is: the dashboard needs to know whether
 * to show the onboarding prompt before any auth context is established.
 */
export const GET = defineRoute<undefined, undefined>(
  { auth: false, rateLimit: "general" },
  async ({ traceId }) => {
    const mgr = await createProductionTokenManager();
    const token = await mgr.getToken(DEV_USER_ID);
    return respond({ configured: token !== null }, { traceId });
  },
);

/**
 * DELETE /api/auth/claude-token — revoke the stored token (logout).
 */
export const DELETE = defineRoute<undefined, undefined>(
  { auth: false, rateLimit: "mutation" },
  async ({ traceId }) => {
    const mgr = await createProductionTokenManager();
    await mgr.revokeToken(DEV_USER_ID);
    return respondNoContent(traceId);
  },
);

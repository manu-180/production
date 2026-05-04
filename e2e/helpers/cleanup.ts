import type { APIRequestContext } from "@playwright/test";
import { TEST_EMAIL, TEST_PASSWORD } from "./auth";

/**
 * Deletes all runs (and their executions) belonging to the E2E test user.
 *
 * Only meaningful when running against a real local stack
 * (pnpm supabase start + pnpm dev). In fully-mocked tests this is a no-op
 * because page.route() intercepts never touch the real DB.
 *
 * Requires an authenticated request context — pass `authenticatedPage.request`
 * from the Playwright fixture.
 */
export async function cleanupTestRuns(request: APIRequestContext): Promise<void> {
  const runsRes = await request.get("/api/runs").catch(() => null);
  if (!runsRes?.ok()) return;

  const body = (await runsRes.json().catch(() => null)) as { runs?: { id: string }[] } | null;
  const runs = body?.runs ?? [];

  await Promise.all(
    runs.map((r) =>
      request.delete(`/api/runs/${r.id}`).catch(() => {
        // Best-effort — don't fail cleanup
      }),
    ),
  );
}

export { TEST_EMAIL, TEST_PASSWORD };

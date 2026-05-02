import { test as base, expect } from "@playwright/test";
import { createTestUser, loginAs } from "../helpers/auth";

// ─── Extended test ────────────────────────────────────────────────────────────

export const test = base.extend<{
  authenticatedPage: import("@playwright/test").Page;
  testPlanId: string;
}>({
  // Authenticated page fixture
  authenticatedPage: async ({ page, baseURL }, use) => {
    const base = baseURL ?? "http://localhost:3000";

    // Ensure the test user exists (idempotent)
    await createTestUser(base);

    // Log in and attach session to the page
    await loginAs(page);

    await use(page);
  },

  // Test plan fixture
  testPlanId: async ({ authenticatedPage }, use) => {
    // Create a minimal plan via the API using the authenticated page's request context
    const res = await authenticatedPage.request.post("/api/plans", {
      data: {
        name: `E2E Test Plan ${Date.now()}`,
        description: "Created by Playwright fixtures — safe to delete",
        prompts: [
          {
            filename: "step-01.md",
            title: "Echo Hello",
            content: "Run `echo hello` in the current directory.",
            frontmatter: {},
            order_index: 0,
          },
        ],
      },
    });

    expect(res.ok(), `POST /api/plans failed: ${res.status()}`).toBeTruthy();

    const body = (await res.json()) as { id: string };
    const planId = body.id;

    await use(planId);

    // Cleanup: delete the plan after the test
    await authenticatedPage.request.delete(`/api/plans/${planId}`).catch(() => {
      // Best-effort cleanup — don't fail the test if this errors.
    });
  },
});

export { expect } from "@playwright/test";

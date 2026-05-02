import type { Page } from "@playwright/test";

export const TEST_EMAIL = process.env.TEST_EMAIL ?? "e2e-test@conductor.local";
export const TEST_PASSWORD = process.env.TEST_PASSWORD ?? "E2eTest123!";

/**
 * Creates a test user via the sign-up API.
 * Ignores 409 Conflict so repeated runs against the same DB are idempotent.
 */
export async function createTestUser(
  baseURL: string,
  email = TEST_EMAIL,
  password = TEST_PASSWORD,
): Promise<void> {
  const res = await fetch(`${baseURL}/api/auth/sign-up`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  // 409 = user already exists — acceptable
  if (!res.ok && res.status !== 409) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`createTestUser failed: ${res.status} ${body}`);
  }
}

/**
 * Signs in programmatically via the sign-in API and stores the resulting
 * auth cookies/localStorage into `page` so subsequent navigations are
 * authenticated.
 */
export async function loginAs(
  page: Page,
  email = TEST_EMAIL,
  password = TEST_PASSWORD,
): Promise<void> {
  // Hit the sign-in endpoint; the server sets an httpOnly session cookie.
  const res = await page.request.post("/api/auth/sign-in", {
    data: { email, password },
  });

  if (!res.ok()) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`loginAs failed: ${res.status()} ${body}`);
  }

  // Navigate to the root so cookies from the API are attached to the page origin.
  await page.goto("/");
  await page.waitForLoadState("networkidle");
}

/**
 * Tears down the test user session by navigating to sign-out (best-effort).
 */
export async function logout(page: Page): Promise<void> {
  await page.request.post("/api/auth/sign-out").catch(() => {
    // Ignore — test cleanup, not critical.
  });
}

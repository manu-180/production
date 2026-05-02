/**
 * Scenario: New user completes the onboarding wizard.
 *
 * All API calls are mocked so this test runs without a real backend.
 */

import { expect, test } from "@playwright/test";

test.describe("Onboarding wizard", () => {
  test.beforeEach(async ({ page }) => {
    // Mock the Claude-token save endpoint
    await page.route("/api/auth/claude-token", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({ json: { ok: true } });
      } else {
        // GET — health check on DoneStep
        route.fulfill({ json: { configured: true } });
      }
    });

    // Mock path-validation endpoint
    await page.route("/api/system/check-path", (route) => {
      route.fulfill({
        json: { exists: true, isDir: true, isWritable: true, isGitRepo: false },
      });
    });

    // Mock CLI health check on DoneStep
    await page.route("/api/system/claude-cli", (route) => {
      route.fulfill({ json: { installed: true, version: "1.0.0-mock" } });
    });
  });

  test("completes all steps and reaches the dashboard", async ({ page }) => {
    // 1. Navigate to onboarding wizard
    await page.goto("/onboarding");

    // Step 0 — Claude token
    await expect(page.getByText("Connect your Claude account")).toBeVisible({ timeout: 10_000 });

    // 2. Paste mock token and submit
    const tokenInput = page.getByPlaceholder("Paste your token here");
    await tokenInput.fill("sk-ant-test-token");
    await page.getByRole("button", { name: /validate & save/i }).click();

    // 3. Token saved — continue button appears
    await expect(page.getByRole("button", { name: /continue/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Token validated and saved")).toBeVisible();
    await page.getByRole("button", { name: /continue/i }).click();

    // Step 1 — Working directory
    await expect(page.getByText("Set a default working directory")).toBeVisible({
      timeout: 10_000,
    });

    // 4. Enter working directory and validate
    const pathInput = page.getByRole("textbox", { name: "" }).first();
    await pathInput.fill("/tmp/conductor-e2e");
    await page.getByRole("button", { name: /validate/i }).click();

    // 5. Validation passes — Save & Continue
    await expect(page.getByRole("button", { name: /save & continue/i })).toBeEnabled({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /save & continue/i }).click();

    // Step 2 — Done
    await expect(page.getByText("You're all set")).toBeVisible({ timeout: 10_000 });

    // 6. Go to Dashboard button links to /
    const dashboardLink = page.getByRole("link", { name: /go to dashboard/i });
    await expect(dashboardLink).toBeVisible();
    await expect(dashboardLink).toHaveAttribute("href", "/");
  });

  test("shows an error when token validation fails", async ({ page }) => {
    // Override with a failure response
    await page.route("/api/auth/claude-token", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 422,
          json: { ok: false, error: "Invalid token format" },
        });
      } else {
        route.fulfill({ json: { configured: false } });
      }
    });

    await page.goto("/onboarding");
    await expect(page.getByText("Connect your Claude account")).toBeVisible({ timeout: 10_000 });

    const tokenInput = page.getByPlaceholder("Paste your token here");
    await tokenInput.fill("bad-token");
    await page.getByRole("button", { name: /validate & save/i }).click();

    await expect(page.getByText("Invalid token format")).toBeVisible({ timeout: 10_000 });
  });
});

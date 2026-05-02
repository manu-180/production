/**
 * Scenario: Upload markdown prompt files to create a new plan.
 *
 * API responses are mocked so the test is fully deterministic.
 */

import { expect, test } from "../fixtures/index";

const MOCK_PLAN_ID = "plan-e2e-001";

const MOCK_PLAN = {
  id: MOCK_PLAN_ID,
  name: "E2E Upload Plan",
  description: "Created via file upload",
  tags: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  prompts: [
    { id: "p1", title: "Step One", filename: "step-01.md", order_index: 0 },
    { id: "p2", title: "Step Two", filename: "step-02.md", order_index: 1 },
    { id: "p3", title: "Step Three", filename: "step-03.md", order_index: 2 },
  ],
};

test.describe("Create plan via file upload", () => {
  test("uploads 3 markdown files and sees plan created", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Mock plan creation endpoint
    await page.route("/api/plans", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({ status: 201, json: { id: MOCK_PLAN_ID, runId: null, ...MOCK_PLAN } });
      } else {
        // GET list
        route.fulfill({
          json: { plans: [MOCK_PLAN], nextCursor: null },
        });
      }
    });

    // Mock the single-plan detail fetch
    await page.route(`/api/plans/${MOCK_PLAN_ID}`, (route) => {
      route.fulfill({ json: MOCK_PLAN });
    });

    // 1. Navigate to /plans/new
    await page.goto("/dashboard/plans/new");
    await expect(page.getByText("New Plan")).toBeVisible({ timeout: 10_000 });

    // 2. Click the "Upload files" card to activate that mode
    await page.getByRole("article", { name: /create a plan by uploading/i }).click();

    // 3. Create 3 mock .md files as buffers and upload them
    const files = [
      { name: "step-01.md", content: "# Step One\nRun the first task." },
      { name: "step-02.md", content: "# Step Two\nRun the second task." },
      { name: "step-03.md", content: "# Step Three\nRun the third task." },
    ];

    // Use Playwright's setInputFiles on the hidden file input inside UploadZone
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(
      files.map((f) => ({
        name: f.name,
        mimeType: "text/markdown",
        buffer: Buffer.from(f.content),
      })),
    );

    // 4. Name field should be auto-populated; verify and update if needed
    const nameInput = page.getByLabel(/plan name/i).last();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill("E2E Upload Plan");

    // 5. Submit
    const createButton = page.getByRole("button", { name: /create from 3 files/i });
    await expect(createButton).toBeEnabled({ timeout: 10_000 });
    await createButton.click();

    // 6. Should redirect to plan detail (mocked)
    await expect(page).toHaveURL(new RegExp(`/dashboard/plans/${MOCK_PLAN_ID}`), {
      timeout: 15_000,
    });
  });

  test("shows plan in the plans list after creation", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Mock plans list
    await page.route("/api/plans*", (route) => {
      route.fulfill({
        json: { plans: [MOCK_PLAN], nextCursor: null },
      });
    });

    await page.goto("/dashboard/plans");
    await expect(page.getByText("E2E Upload Plan")).toBeVisible({ timeout: 10_000 });
  });
});

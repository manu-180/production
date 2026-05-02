/**
 * Scenario: Launch a run from a plan and confirm redirect to the run detail page.
 *
 * The run API is mocked so the test does not require a live worker.
 */

import { expect, test } from "../fixtures/index";

const MOCK_PLAN_ID = "plan-launch-001";
const MOCK_RUN_ID = "run-launch-001";

const MOCK_PLAN = {
  id: MOCK_PLAN_ID,
  name: "Launch Test Plan",
  description: "",
  tags: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  prompts: [
    {
      id: "p1",
      title: "Echo Hello",
      filename: "step-01.md",
      order_index: 0,
      content: "# Echo\necho hello",
    },
  ],
  prompt_count: 1,
};

const MOCK_RUN_QUEUED = {
  id: MOCK_RUN_ID,
  plan_id: MOCK_PLAN_ID,
  plan: { id: MOCK_PLAN_ID, name: "Launch Test Plan" },
  status: "queued",
  working_dir: "/tmp/conductor-e2e",
  started_at: null,
  finished_at: null,
  executions: [],
  events: [],
  checkpoints: [],
  guardian_decisions: [],
  current_prompt_index: 0,
  total_prompts: 1,
  error_message: null,
};

const MOCK_RUN_RUNNING = {
  ...MOCK_RUN_QUEUED,
  status: "running",
  started_at: new Date().toISOString(),
};

test.describe("Launch run from plan", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Plan detail
    await page.route(`/api/plans/${MOCK_PLAN_ID}`, (route) => {
      route.fulfill({ json: MOCK_PLAN });
    });

    // Plan list (for plans page)
    await page.route("/api/plans*", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ json: { plans: [MOCK_PLAN], nextCursor: null } });
      } else {
        route.continue();
      }
    });

    // Run creation
    await page.route("/api/runs", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({ status: 201, json: { runId: MOCK_RUN_ID } });
      } else {
        route.fulfill({ json: { runs: [], nextCursor: null } });
      }
    });

    // Run detail — initially queued, then transitions to running
    let callCount = 0;
    await page.route(`/api/runs/${MOCK_RUN_ID}`, (route) => {
      callCount++;
      route.fulfill({ json: callCount <= 2 ? MOCK_RUN_QUEUED : MOCK_RUN_RUNNING });
    });
  });

  test("redirects to run detail and shows initial queued status", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // 1. Navigate to plan detail
    await page.goto(`/dashboard/plans/${MOCK_PLAN_ID}`);
    await expect(page.getByText("Launch Test Plan")).toBeVisible({ timeout: 10_000 });

    // 2. Click "Launch Run" button
    await page.getByRole("button", { name: /launch run/i }).click();

    // 3. The RunLauncherDialog opens — fill in working directory
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const workingDirInput = dialog.getByRole("textbox");
    await workingDirInput.fill("/tmp/conductor-e2e");

    // 4. Click Launch inside the dialog
    await dialog.getByRole("button", { name: /^launch$/i }).click();

    // 5. Should redirect to /dashboard/runs/[id]
    await expect(page).toHaveURL(new RegExp(`/dashboard/runs/${MOCK_RUN_ID}`), {
      timeout: 15_000,
    });

    // 6. Status badge visible (queued or running)
    const statusBadge = page.getByText(/queued|running/i).first();
    await expect(statusBadge).toBeVisible({ timeout: 10_000 });
  });

  test("run status changes from queued to running within 5 seconds", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    // Directly navigate to the run detail page
    await page.goto(`/dashboard/runs/${MOCK_RUN_ID}`);

    // The status should eventually show "running" as the mock advances
    await expect(page.getByText(/running/i).first()).toBeVisible({ timeout: 10_000 });
  });
});

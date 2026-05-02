/**
 * Scenario: Pause a running run and then resume it.
 *
 * Control buttons (Pause / Resume) are driven by mocked API responses.
 */

import { expect, test } from "../fixtures/index";

const MOCK_RUN_ID = "run-pause-001";
const MOCK_PLAN_ID = "plan-pause-001";

type RunStatus = "running" | "paused" | "completed";

function buildRun(status: RunStatus) {
  return {
    id: MOCK_RUN_ID,
    plan_id: MOCK_PLAN_ID,
    plan: { id: MOCK_PLAN_ID, name: "Pause Resume Plan" },
    status,
    working_dir: "/tmp/conductor-e2e",
    started_at: new Date().toISOString(),
    finished_at: status === "completed" ? new Date().toISOString() : null,
    current_prompt_index: 0,
    total_prompts: 2,
    error_message: null,
    executions: [],
    events: [],
    checkpoints: [],
    guardian_decisions: [],
  };
}

test.describe("Pause and resume a run", () => {
  test("pauses a running run, then resumes it", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Track state server-side so the run detail reflects mutations
    let currentStatus: RunStatus = "running";

    await page.route(`/api/runs/${MOCK_RUN_ID}`, (route) => {
      route.fulfill({ json: buildRun(currentStatus) });
    });

    await page.route(`/api/runs/${MOCK_RUN_ID}/pause`, (route) => {
      currentStatus = "paused";
      route.fulfill({ json: { ok: true } });
    });

    await page.route(`/api/runs/${MOCK_RUN_ID}/resume`, (route) => {
      currentStatus = "running";
      route.fulfill({ json: { ok: true } });
    });

    await page.route(`/api/runs/${MOCK_RUN_ID}/guardian`, (route) => {
      route.fulfill({ json: [] });
    });

    await page.route(`/api/runs/${MOCK_RUN_ID}/stream`, (route) => {
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body: "",
      });
    });

    // 1. Navigate to run detail (status = running)
    await page.goto(`/dashboard/runs/${MOCK_RUN_ID}`);
    await expect(page.getByText("Pause Resume Plan")).toBeVisible({ timeout: 10_000 });

    // 2. "Pause" button is visible while running
    const pauseButton = page.getByRole("button", { name: /pause/i });
    await expect(pauseButton).toBeVisible({ timeout: 10_000 });

    // 3. Click Pause
    await pauseButton.click();

    // 4. Status badge changes to "paused"
    await expect(page.getByText(/paused/i).first()).toBeVisible({ timeout: 10_000 });

    // 5. "Resume" button appears
    const resumeButton = page.getByRole("button", { name: /resume/i });
    await expect(resumeButton).toBeVisible({ timeout: 10_000 });

    // 6. Click Resume
    await resumeButton.click();

    // 7. Status returns to "running"
    await expect(page.getByText(/running/i).first()).toBeVisible({ timeout: 10_000 });
  });
});

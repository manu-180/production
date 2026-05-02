/**
 * Scenario: View a checkpoint diff and perform a rollback.
 *
 * The diff and rollback endpoints are mocked so the test does not
 * require a live git repository.
 */

import { expect, test } from "../fixtures/index";

const MOCK_RUN_ID = "run-checkpoint-001";
const MOCK_PLAN_ID = "plan-checkpoint-001";
const MOCK_CHECKPOINT_ID = "ckpt-001";
const MOCK_PROMPT_ID = "p-ckpt-01";

const MOCK_DIFF = `diff --git a/output.txt b/output.txt
index e69de29..ce01362 100644
--- a/output.txt
+++ b/output.txt
@@ -0,0 +1 @@
+hello world
`;

const MOCK_RUN = {
  id: MOCK_RUN_ID,
  plan_id: MOCK_PLAN_ID,
  plan: { id: MOCK_PLAN_ID, name: "Checkpoint Test Plan" },
  status: "completed",
  working_dir: "/tmp/conductor-e2e",
  started_at: new Date(Date.now() - 60_000).toISOString(),
  finished_at: new Date().toISOString(),
  current_prompt_index: 1,
  total_prompts: 1,
  error_message: null,
  executions: [
    {
      id: "exec-ckpt-01",
      prompt_id: MOCK_PROMPT_ID,
      status: "completed",
      started_at: new Date(Date.now() - 60_000).toISOString(),
      finished_at: new Date().toISOString(),
    },
  ],
  events: [],
  checkpoints: [
    {
      id: MOCK_CHECKPOINT_ID,
      run_id: MOCK_RUN_ID,
      prompt_id: MOCK_PROMPT_ID,
      git_ref: "abc1234",
      created_at: new Date().toISOString(),
    },
  ],
  guardian_decisions: [],
};

test.describe("Checkpoint and rollback", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    await page.route(`/api/runs/${MOCK_RUN_ID}`, (route) => {
      route.fulfill({ json: MOCK_RUN });
    });

    await page.route(`/api/runs/${MOCK_RUN_ID}/diff*`, (route) => {
      route.fulfill({
        json: {
          diff: MOCK_DIFF,
          checkpointId: MOCK_CHECKPOINT_ID,
          gitRef: "abc1234",
        },
      });
    });

    await page.route(`/api/runs/${MOCK_RUN_ID}/rollback`, (route) => {
      route.fulfill({ json: { ok: true, message: "Rolled back to checkpoint abc1234" } });
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
  });

  test("opens checkpoint diff view and successfully rolls back", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // 1. Navigate to run detail (completed)
    await page.goto(`/dashboard/runs/${MOCK_RUN_ID}`);
    await expect(page.getByText("Checkpoint Test Plan")).toBeVisible({ timeout: 10_000 });

    // 2. Navigate to diff sub-page directly (the link may be inside the run detail)
    await page.goto(`/dashboard/runs/${MOCK_RUN_ID}/diff?checkpointId=${MOCK_CHECKPOINT_ID}`);

    // 3. Git diff text is displayed
    await expect(page.getByText(/diff --git|output\.txt|\+hello world/i).first()).toBeVisible({
      timeout: 10_000,
    });

    // 4. Click "Rollback" button
    const rollbackButton = page.getByRole("button", { name: /rollback/i });
    await expect(rollbackButton).toBeVisible({ timeout: 10_000 });
    await rollbackButton.click();

    // 5. Confirmation dialog (window.confirm or a dialog element)
    // Handle native confirm dialogs
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toMatch(/rollback|confirm/i);
      await dialog.accept();
    });

    // If there's an in-page confirmation dialog instead:
    const confirmButton = page.getByRole("button", { name: /confirm|yes.*rollback/i });
    if (await confirmButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await confirmButton.click();
    }

    // 6. Toast notification: rollback successful
    await expect(page.getByText(/rollback.*success|rolled back|success/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});

/**
 * Scenario: Guardian presents an approval-required prompt; user approves it.
 *
 * The ApprovalModal is driven by a mocked run that has an execution in
 * "awaiting_approval" status. After the user approves, the modal closes
 * and the run continues.
 */

import { expect, test } from "../fixtures/index";

const MOCK_RUN_ID = "run-guardian-001";
const MOCK_PLAN_ID = "plan-guardian-001";
const MOCK_EXEC_ID = "exec-guardian-01";
const MOCK_PROMPT_ID = "p-guardian-01";

function buildRunWithApproval(execStatus: "awaiting_approval" | "running" | "completed") {
  return {
    id: MOCK_RUN_ID,
    plan_id: MOCK_PLAN_ID,
    plan: { id: MOCK_PLAN_ID, name: "Guardian Decision Plan" },
    status: execStatus === "completed" ? "completed" : "running",
    working_dir: "/tmp/conductor-e2e",
    started_at: new Date().toISOString(),
    finished_at: execStatus === "completed" ? new Date().toISOString() : null,
    current_prompt_index: 0,
    total_prompts: 1,
    error_message: null,
    executions: [
      {
        id: MOCK_EXEC_ID,
        prompt_id: MOCK_PROMPT_ID,
        status: execStatus,
        content: "Before proceeding, should I delete the existing files?",
        started_at: new Date().toISOString(),
        finished_at: execStatus === "completed" ? new Date().toISOString() : null,
      },
    ],
    events: [
      {
        id: "evt-g-01",
        type: "assistant",
        payload: { text: "Before proceeding, I need to ask: should I delete the existing files?" },
        created_at: new Date().toISOString(),
        sequence: 1,
      },
    ],
    checkpoints: [],
    guardian_decisions: [],
  };
}

test.describe("Guardian decision", () => {
  test("approval modal appears and run continues after user approves", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    let execStatus: "awaiting_approval" | "running" | "completed" = "awaiting_approval";

    await page.route(`/api/runs/${MOCK_RUN_ID}`, (route) => {
      route.fulfill({ json: buildRunWithApproval(execStatus) });
    });

    // Approve endpoint — transition status
    await page.route(`/api/runs/${MOCK_RUN_ID}/approve-prompt`, (route) => {
      execStatus = "completed";
      route.fulfill({ json: { ok: true } });
    });

    // Decisions endpoint (guardian feed)
    await page.route(`/api/runs/${MOCK_RUN_ID}/decisions`, (route) => {
      if (route.request().method() === "POST") {
        execStatus = "completed";
        route.fulfill({ json: { ok: true } });
      } else {
        route.fulfill({ json: [] });
      }
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

    // 1. Navigate to run detail — execution is awaiting_approval
    await page.goto(`/dashboard/runs/${MOCK_RUN_ID}`);
    await expect(page.getByText("Guardian Decision Plan")).toBeVisible({ timeout: 10_000 });

    // 2. ApprovalModal opens automatically
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible({ timeout: 15_000 });

    // 3. Question text is visible inside the modal
    await expect(page.getByText(/approval required|awaiting|should i delete/i).first()).toBeVisible(
      { timeout: 10_000 },
    );

    // 4. Click "Approve & continue"
    await page.getByRole("button", { name: /approve.*continue/i }).click();

    // 5. Modal closes
    await expect(modal).not.toBeVisible({ timeout: 10_000 });

    // 6. Run transitions to completed
    await expect(page.getByText(/completed/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("guardian decisions page shows decision history", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    const DECISION = {
      id: "decision-01",
      run_id: MOCK_RUN_ID,
      question_detected: "Should I delete the existing files?",
      decision: "approved",
      strategy: "heuristic",
      confidence: 0.92,
      created_at: new Date().toISOString(),
    };

    await page.route(`/api/runs/${MOCK_RUN_ID}/decisions`, (route) => {
      route.fulfill({ json: [DECISION] });
    });

    await page.goto(`/dashboard/runs/${MOCK_RUN_ID}/decisions`);

    await expect(page.getByText(/should i delete|approved/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

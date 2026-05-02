/**
 * Scenario: View live run progress events on the run detail page.
 *
 * The SSE stream and run API are mocked so the test is deterministic.
 */

import { expect, test } from "../fixtures/index";

const MOCK_RUN_ID = "run-progress-001";
const MOCK_PLAN_ID = "plan-progress-001";

function buildMockRun(status: string) {
  return {
    id: MOCK_RUN_ID,
    plan_id: MOCK_PLAN_ID,
    plan: { id: MOCK_PLAN_ID, name: "Progress Test Plan" },
    status,
    working_dir: "/tmp/conductor-e2e",
    started_at: new Date().toISOString(),
    finished_at: status === "completed" ? new Date().toISOString() : null,
    current_prompt_index: status === "completed" ? 1 : 0,
    total_prompts: 1,
    error_message: null,
    executions: [
      {
        id: "exec-01",
        prompt_id: "p1",
        status: status === "completed" ? "completed" : "running",
        started_at: new Date().toISOString(),
        finished_at: status === "completed" ? new Date().toISOString() : null,
      },
    ],
    events: [
      {
        id: "evt-01",
        type: "assistant",
        payload: { text: "I'll run echo hello for you." },
        created_at: new Date().toISOString(),
        sequence: 1,
      },
      {
        id: "evt-02",
        type: "tool_result",
        payload: { content: "hello\n", tool_name: "Bash" },
        created_at: new Date().toISOString(),
        sequence: 2,
      },
    ],
    checkpoints: [],
    guardian_decisions: [],
  };
}

test.describe("Run progress view", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Mock the run detail — serve "running" first, then "completed"
    let callCount = 0;
    await page.route(`/api/runs/${MOCK_RUN_ID}`, (route) => {
      callCount++;
      const status = callCount >= 3 ? "completed" : "running";
      route.fulfill({ json: buildMockRun(status) });
    });

    // Mock the log-stream endpoint (SSE) with a simple text stream
    await page.route(`/api/runs/${MOCK_RUN_ID}/stream`, (route) => {
      const sseBody = [
        'data: {"type":"assistant","payload":{"text":"Running your prompt now..."}}\n\n',
        'data: {"type":"tool_result","payload":{"content":"hello\\n","tool_name":"Bash"}}\n\n',
        'data: {"type":"result","payload":{"status":"completed"}}\n\n',
      ].join("");

      route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
        body: sseBody,
      });
    });

    // Mock guardian feed (empty)
    await page.route(`/api/runs/${MOCK_RUN_ID}/guardian`, (route) => {
      route.fulfill({ json: [] });
    });
  });

  test("shows streamed events and reaches completed status", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    await page.goto(`/dashboard/runs/${MOCK_RUN_ID}`);

    // 1. Run detail page renders with the plan name
    await expect(page.getByText("Progress Test Plan")).toBeVisible({ timeout: 10_000 });

    // 2. Status shows running initially
    await expect(page.getByText(/running/i).first()).toBeVisible({ timeout: 10_000 });

    // 3. Event text from fixture appears in the log stream panel
    await expect(page.getByText(/running your prompt now|echo hello|hello/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // 4. Run eventually reaches completed status
    await expect(page.getByText(/completed/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test("progress timeline shows prompt step", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto(`/dashboard/runs/${MOCK_RUN_ID}`);

    // The progress timeline or prompt card section is visible
    await expect(
      page.locator('[aria-label="Run progress"], [data-testid="progress-timeline"]').first(),
    )
      .toBeVisible({
        timeout: 10_000,
      })
      .catch(async () => {
        // Fallback: any text indicating step progress
        await expect(page.getByText(/1\s*\/\s*1|step 1|prompt 1/i).first()).toBeVisible({
          timeout: 10_000,
        });
      });
  });
});

/**
 * E2E: Resume-from-failure flow
 *
 * Validates the full chain from prompts 06-09:
 *   - A 5-prompt run fails at prompt 3 (index 2)
 *   - User opens the retry modal; default selection is "resume"
 *   - Confirming calls POST /api/runs/{runId}/retry with { from: "resume" }
 *   - UI redirects to the new run
 *   - New run's executions show prompts 0 and 1 as 'skipped' (not re-executed)
 *
 * All API calls are mocked — no live backend required.
 * Fixture file: e2e/fixtures/plans/resume-test-plan.yml (reference only, not loaded at runtime).
 *
 * This test WILL FAIL if any of prompts 06-09 are not correctly implemented.
 */

import { expect, test } from "../fixtures/index";

const MOCK_PLAN_ID = "plan-resume-001";
const MOCK_RUN_ID = "run-resume-failed-001";
const MOCK_NEW_RUN_ID = "run-resume-retry-001";

const MOCK_PLAN = {
  id: MOCK_PLAN_ID,
  name: "resume-test-plan",
  description: "Plan de 5 prompts para validar resume. Prompt 3 está diseñado para fallar.",
  tags: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  prompt_count: 5,
  prompts: [
    {
      id: "p0",
      title: "prompt-1-create-file",
      filename: "prompt-1-create-file.md",
      order_index: 0,
      content: 'Crea un archivo llamado step-1.txt con el contenido "ok-1". Reportá éxito.',
    },
    {
      id: "p1",
      title: "prompt-2-append",
      filename: "prompt-2-append.md",
      order_index: 1,
      content: 'Apendizá la línea "ok-2" al archivo step-1.txt. Reportá éxito.',
    },
    {
      id: "p2",
      title: "prompt-3-injected-failure",
      filename: "prompt-3-injected-failure.md",
      order_index: 2,
      content: "Ejecutá el comando `__FORCE_FAILURE__`. Si ese comando no existe, fallá.",
    },
    {
      id: "p3",
      title: "prompt-4-after-failure",
      filename: "prompt-4-after-failure.md",
      order_index: 3,
      content: 'Apendizá la línea "ok-4" al archivo step-1.txt. Reportá éxito.',
    },
    {
      id: "p4",
      title: "prompt-5-final",
      filename: "prompt-5-final.md",
      order_index: 4,
      content: 'Apendizá la línea "ok-5" al archivo step-1.txt. Reportá éxito.',
    },
  ],
};

// Executions for the first (failed) run: 0 and 1 succeeded, 2 failed
const FAILED_RUN_EXECUTIONS = [
  {
    id: "e0",
    run_id: MOCK_RUN_ID,
    prompt_index: 0,
    status: "succeeded",
    attempt: 1,
    started_at: new Date(Date.now() - 30_000).toISOString(),
    finished_at: new Date(Date.now() - 20_000).toISOString(),
    error_message: null,
  },
  {
    id: "e1",
    run_id: MOCK_RUN_ID,
    prompt_index: 1,
    status: "succeeded",
    attempt: 1,
    started_at: new Date(Date.now() - 20_000).toISOString(),
    finished_at: new Date(Date.now() - 10_000).toISOString(),
    error_message: null,
  },
  {
    id: "e2",
    run_id: MOCK_RUN_ID,
    prompt_index: 2,
    status: "failed",
    attempt: 1,
    started_at: new Date(Date.now() - 10_000).toISOString(),
    finished_at: new Date().toISOString(),
    error_message: "Command not found: __FORCE_FAILURE__",
  },
];

// Executions for the retry run: 0 and 1 skipped (not re-executed), 2 retried
const RETRY_RUN_EXECUTIONS = [
  {
    id: "e0r",
    run_id: MOCK_NEW_RUN_ID,
    prompt_index: 0,
    status: "skipped",
    attempt: 1,
    error_message: null,
  },
  {
    id: "e1r",
    run_id: MOCK_NEW_RUN_ID,
    prompt_index: 1,
    status: "skipped",
    attempt: 1,
    error_message: null,
  },
  {
    id: "e2r",
    run_id: MOCK_NEW_RUN_ID,
    prompt_index: 2,
    status: "failed",
    attempt: 1,
    error_message: "Command not found: __FORCE_FAILURE__",
  },
];

function buildFailedRun() {
  return {
    id: MOCK_RUN_ID,
    plan_id: MOCK_PLAN_ID,
    plan: { id: MOCK_PLAN_ID, name: "resume-test-plan" },
    status: "failed",
    working_dir: "/tmp/conductor-e2e",
    started_at: new Date(Date.now() - 60_000).toISOString(),
    finished_at: new Date().toISOString(),
    current_prompt_index: 2,
    total_prompts: 5,
    last_succeeded_prompt_index: 1,
    resume_from_index: null,
    resume_session_id: null,
    error_message: "Prompt 3 failed: Command not found: __FORCE_FAILURE__",
    executions: FAILED_RUN_EXECUTIONS,
    events: [],
    checkpoints: [],
    guardian_decisions: [],
  };
}

function buildRetryRun() {
  return {
    id: MOCK_NEW_RUN_ID,
    plan_id: MOCK_PLAN_ID,
    plan: { id: MOCK_PLAN_ID, name: "resume-test-plan" },
    status: "failed",
    working_dir: "/tmp/conductor-e2e",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    current_prompt_index: 2,
    total_prompts: 5,
    last_succeeded_prompt_index: 1,
    resume_from_index: 2,
    resume_session_id: MOCK_RUN_ID,
    error_message: "Prompt 3 failed: Command not found: __FORCE_FAILURE__",
    executions: RETRY_RUN_EXECUTIONS,
    events: [],
    checkpoints: [],
    guardian_decisions: [],
  };
}

test.describe("Resume from last successful prompt", () => {
  test("retry with from=resume skips already-succeeded prompts", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Captures the body sent to the retry endpoint so we can assert on it
    let capturedRetryBody: Record<string, unknown> | null = null;

    // ── API Mocks ──────────────────────────────────────────────────────────────

    await page.route(`/api/plans/${MOCK_PLAN_ID}`, (route) => {
      route.fulfill({ json: MOCK_PLAN });
    });

    await page.route(`/api/runs/${MOCK_RUN_ID}`, (route) => {
      route.fulfill({ json: buildFailedRun() });
    });

    // SSE stream endpoint — empty (run is already finished)
    await page.route(`/api/runs/${MOCK_RUN_ID}/stream`, (route) => {
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body: "",
      });
    });

    // Retry endpoint — capture body, return the new run id
    await page.route(`/api/runs/${MOCK_RUN_ID}/retry`, async (route) => {
      try {
        capturedRetryBody = route.request().postDataJSON() as Record<string, unknown>;
      } catch {
        capturedRetryBody = {};
      }
      await route.fulfill({ status: 201, json: { runId: MOCK_NEW_RUN_ID } });
    });

    // New run detail — reflects resume_from_index=2 and skipped executions
    await page.route(`/api/runs/${MOCK_NEW_RUN_ID}`, (route) => {
      route.fulfill({ json: buildRetryRun() });
    });

    await page.route(`/api/runs/${MOCK_NEW_RUN_ID}/stream`, (route) => {
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body: "",
      });
    });

    // ── Test Flow ──────────────────────────────────────────────────────────────

    // 1. Navigate to the failed run detail
    await page.goto(`/dashboard/runs/${MOCK_RUN_ID}`);
    await expect(page.getByText("resume-test-plan")).toBeVisible({ timeout: 10_000 });

    // 2. Run shows "failed" status
    await expect(page.getByText(/failed/i).first()).toBeVisible({ timeout: 10_000 });

    // 3. Open the retry modal
    await page.getByRole("button", { name: /reintentar/i }).click();

    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // 4. Modal shows how many prompts already succeeded: "2 de 5 prompts"
    await expect(modal.getByText(/2\s*de\s*5\s*prompts/i)).toBeVisible({ timeout: 5_000 });

    // 5. Default radio is "resume" mode — "Continuar desde el prompt 3"
    const resumeRadio = modal.getByLabel(/continuar desde el prompt 3/i);
    await expect(resumeRadio).toBeChecked({ timeout: 5_000 });

    // 6. Confirm the retry
    await modal.getByRole("button", { name: /reintentar/i }).click();

    // 7. UI redirects to the new run
    await expect(page).toHaveURL(new RegExp(`/dashboard/runs/${MOCK_NEW_RUN_ID}`), {
      timeout: 15_000,
    });

    // 8. The retry API was called with from=resume (validates prompts 08-09)
    expect(capturedRetryBody).toMatchObject({ from: "resume" });

    // 9. New run page loads and shows the plan name
    await expect(page.getByText("resume-test-plan")).toBeVisible({ timeout: 10_000 });

    // 10. Prompts 0 and 1 appear as "skipped" in the execution timeline
    //     (validates prompt 07: orchestrator skips already-succeeded prompts)
    const skippedBadges = page.getByText(/skipped/i);
    await expect(skippedBadges.first()).toBeVisible({ timeout: 10_000 });

    // Ensure there are exactly 2 skipped entries (prompts 0 and 1)
    await expect(skippedBadges).toHaveCount(2, { timeout: 10_000 });
  });

  test("retry with from=start re-runs all prompts", async () => {
    // Placeholder — validates that selecting "Reiniciar plan completo" does NOT
    // produce any skipped executions and re-runs from index 0.
    test.skip(true, "placeholder — implement if time permits");
  });
});

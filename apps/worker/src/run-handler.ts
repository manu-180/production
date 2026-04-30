/**
 * Conductor — Worker / RunHandler
 *
 * Owns the lifecycle of a single `runs` row: loads the plan, builds an
 * {@link Orchestrator}, and exposes pause/resume/cancel handles so the worker
 * process can react to control signals (graceful shutdown today; HTTP/realtime
 * control in a later phase).
 *
 * Telemetry-only failures (e.g. progress emit errors) are absorbed by the
 * orchestrator. Anything thrown out of `execute()` is a load-time failure
 * (missing run, missing plan, DB unreachable) — the caller is expected to
 * mark the run failed accordingly.
 */

import {
  ConcreteCheckpointManager,
  type DbClient,
  GitManager,
  Orchestrator,
  PauseController,
  type Plan,
  type RepoInitResult,
  RepoInitializer,
  type RunEvent,
  type RunResult,
  loadPlanFromDb,
} from "@conductor/core";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import type { Logger } from "pino";

export interface RunHandlerOptions {
  runId: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  logger: Logger;
}

interface RunRow {
  plan_id: string;
  working_dir: string;
}

/**
 * Handles one run end-to-end. A handler is single-use: call `execute()` once
 * per instance.
 */
export class RunHandler {
  private readonly _runId: string;
  private readonly supabaseUrl: string;
  private readonly supabaseServiceKey: string;
  private readonly logger: Logger;
  private orchestrator: Orchestrator | null = null;
  private running = false;

  constructor(opts: RunHandlerOptions) {
    this._runId = opts.runId;
    this.supabaseUrl = opts.supabaseUrl;
    this.supabaseServiceKey = opts.supabaseServiceKey;
    this.logger = opts.logger;
  }

  get runId(): string {
    return this._runId;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Execute the run. Loads the plan from the DB, constructs an
   * {@link Orchestrator}, and awaits its terminal result. The `running`
   * flag flips false in `finally` so callers can rely on it even when an
   * unexpected error escapes.
   */
  async execute(): Promise<void> {
    this.running = true;
    try {
      const supabase = createClient(this.supabaseUrl, this.supabaseServiceKey);

      // The orchestrator's DbClient is structurally narrower than the
      // Supabase JS client: same `from(...).insert/update/select/eq/single`
      // surface, with `{ data, error }` results. Cast through `unknown` to
      // satisfy the structural-but-not-identical typing.
      const db = supabase as unknown as DbClient;

      const runRow = await this.loadRunRow(supabase);
      if (runRow === null) {
        this.logger.error({ runId: this._runId }, "run row not found");
        await this.markRunFailed(supabase, this._runId, "run row not found");
        return;
      }

      let plan: Plan;
      try {
        // `loadPlanFromDb` accepts a structurally typed Supabase-like client.
        plan = await loadPlanFromDb(
          runRow.plan_id,
          supabase as unknown as Parameters<typeof loadPlanFromDb>[1],
        );
      } catch (err) {
        this.logger.error(
          { runId: this._runId, planId: runRow.plan_id, err },
          "failed to load plan from db",
        );
        await this.markRunFailed(
          supabase,
          this._runId,
          `failed to load plan from db: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }

      // ── Git checkpoint setup ─────────────────────────────────────────
      // Initialize the working dir as a git repo (or use the existing one),
      // stash any dirty state, and create a run-scoped branch. If any of
      // this fails we cannot safely run — mark the run failed and bail.
      const gitManager = new GitManager(runRow.working_dir, runRow.working_dir);
      const repoInitializer = new RepoInitializer(gitManager);

      let repoInitResult: RepoInitResult;
      try {
        repoInitResult = await repoInitializer.initForRun(runRow.working_dir, this._runId, {
          autoInitGit: true,
          autoStash: true,
        });
      } catch (err) {
        this.logger.error({ runId: this._runId, err }, "failed to initialize git repo for run");
        await this.markRunFailed(
          supabase,
          this._runId,
          `git init failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }

      const checkpointManager = new ConcreteCheckpointManager(
        gitManager,
        this._runId,
        runRow.working_dir,
      );

      let runInitDone = false;
      try {
        const runInit = await checkpointManager.initRun(repoInitResult.originalBranch);
        runInitDone = true;

        // Pre-populate prompt metadata for richer commit messages.
        for (const prompt of plan.prompts) {
          checkpointManager.setPromptMeta(prompt.id, {
            title: prompt.frontmatter.title ?? prompt.id,
            filename: prompt.filename,
            order: prompt.order,
            total: plan.prompts.length,
          });
        }

        // Persist checkpoint_branch on the run row so the UI can reference it.
        try {
          await supabase
            .from("runs")
            .update({ checkpoint_branch: runInit.runBranch })
            .eq("id", this._runId);
        } catch (e) {
          this.logger.warn(
            { runId: this._runId, err: e },
            "failed to persist checkpoint_branch on run row",
          );
        }
      } catch (err) {
        this.logger.error({ runId: this._runId, err }, "failed to initialize checkpoint run");
        // Try to undo the stash/branch state we may have created.
        try {
          await repoInitializer.restoreAfterRun(repoInitResult);
        } catch (restoreErr) {
          this.logger.error(
            { runId: this._runId, err: restoreErr },
            "failed to restore repo after init failure",
          );
        }
        await this.markRunFailed(
          supabase,
          this._runId,
          `checkpoint initRun failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }

      const pauseController = new PauseController();
      const logger = this.logger;
      this.orchestrator = new Orchestrator({
        plan,
        workingDir: runRow.working_dir,
        runId: this._runId,
        db,
        pauseController,
        onEvent: (event: RunEvent): void => {
          logger.debug({ runId: this._runId, event }, "run event");
        },
        checkpoint: checkpointManager,
      });

      this.logger.info(
        { runId: this._runId, planId: runRow.plan_id, prompts: plan.prompts.length },
        "starting orchestrator",
      );

      let result: RunResult | null = null;
      try {
        result = await this.orchestrator.run();
      } finally {
        // Always finalize the checkpoint and restore the repo, even on errors.
        // Failures here are logged but do not change the run outcome.
        if (runInitDone) {
          try {
            await checkpointManager.finishRun(
              result?.status === "completed",
              repoInitResult.originalBranch,
              { mergeToOriginal: true, deleteRunBranch: true },
            );
          } catch (err) {
            this.logger.error({ runId: this._runId, err }, "failed to finalize checkpoint");
          }
          try {
            await repoInitializer.restoreAfterRun(repoInitResult);
          } catch (err) {
            this.logger.error({ runId: this._runId, err }, "failed to restore repo after run");
          }
        }
      }

      this.logger.info(
        {
          runId: this._runId,
          status: result.status,
          completed: result.completedPrompts,
          totalCostUsd: result.totalCostUsd,
          durationMs: result.totalDurationMs,
        },
        "orchestrator finished",
      );
    } finally {
      this.running = false;
      this.orchestrator = null;
    }
  }

  /** Pause the currently running orchestrator. No-op if none. */
  pause(): void {
    this.orchestrator?.pause();
  }

  /** Resume the currently running orchestrator. No-op if none. */
  resume(): void {
    this.orchestrator?.resume();
  }

  /** Cancel the currently running orchestrator. No-op if none. */
  cancel(reason: string): void {
    this.orchestrator?.cancel(reason);
  }

  /**
   * Best-effort transition of the `runs` row to `failed` status. Used when an
   * early failure (missing row, plan load error, etc.) prevents the
   * orchestrator from being constructed — without this update the row would
   * remain stuck in `running` forever.
   */
  private async markRunFailed(db: SupabaseClient, runId: string, reason: string): Promise<void> {
    try {
      await db
        .from("runs")
        .update({ status: "failed", finished_at: new Date().toISOString() })
        .eq("id", runId);
      this.logger.info({ runId, reason }, "marked run as failed");
    } catch (e) {
      this.logger.error({ err: e, runId, reason }, "failed to mark run as failed in DB");
    }
  }

  /**
   * Fetch the run row needed by the orchestrator. Returns `null` if the row
   * is missing or the query errors — both are non-recoverable from the
   * worker's perspective and are logged by the caller.
   */
  private async loadRunRow(supabase: SupabaseClient): Promise<RunRow | null> {
    const { data, error } = await supabase
      .from("runs")
      .select("plan_id, working_dir")
      .eq("id", this._runId)
      .single();

    if (error !== null) {
      this.logger.error({ runId: this._runId, error }, "failed to query run row");
      return null;
    }
    if (data === null) {
      return null;
    }

    const row = data as { plan_id?: unknown; working_dir?: unknown };
    if (typeof row.plan_id !== "string" || typeof row.working_dir !== "string") {
      this.logger.error({ runId: this._runId, row }, "run row missing plan_id or working_dir");
      return null;
    }
    return { plan_id: row.plan_id, working_dir: row.working_dir };
  }
}

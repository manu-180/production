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
  AuditLogger,
  ConcreteCheckpointManager,
  type DbClient,
  GitManager,
  type GuardianDbClient,
  Orchestrator,
  PauseController,
  type Plan,
  type RepoInitResult,
  RepoInitializer,
  type RunEvent,
  type RunResult,
  loadPlanFromDb,
} from "@conductor/core";
import type { HealthMonitor } from "@conductor/core";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { createHeartbeat } from "./heartbeat.js";
import { RunControlChannel } from "./run-control-channel.js";

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
  private heartbeat: HealthMonitor | null = null;
  private controlChannel: RunControlChannel | null = null;

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

      // Heartbeat: tells the orphan-recovery sweeper this worker still owns
      // the run. Started here (right after we have a db client) so even an
      // early load-time failure is covered by an `await stop()` in finally.
      this.heartbeat = createHeartbeat(db, { intervalMs: 10_000, logger: this.logger });
      this.heartbeat.start(this._runId);

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
      let runInit: Awaited<ReturnType<typeof checkpointManager.initRun>> | null = null;
      try {
        // noBranch:true — single-developer workflow. All conductor commits land
        // directly on the original branch (typically `main`). No conductor/run-*
        // branches are created or merged. Configured per CLAUDE.md: "REGLA
        // ABSOLUTA: SOLO main, NUNCA crear branches".
        runInit = await checkpointManager.initRun(repoInitResult.originalBranch, {
          noBranch: true,
        });
        runInitDone = true;

        // Pre-populate prompt metadata for richer commit messages.
        // `prompt.filename` is `string | null` since UI-created prompts have
        // no source file. CheckpointManager expects a string (the commit
        // message just renders "Prompt: <filename>"), so we fall back to the
        // prompt id when filename is null.
        for (const prompt of plan.prompts) {
          checkpointManager.setPromptMeta(prompt.id, {
            title: prompt.frontmatter.title ?? prompt.id,
            filename: prompt.filename ?? prompt.id,
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
          await repoInitializer.restoreAfterRun(repoInitResult, runRow.working_dir);
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

      // Skip-if-already-done: collect prompt_ids that succeeded in any prior
      // run of this same plan. The orchestrator marks these as `skipped` and
      // doesn't re-execute them — avoids duplicate work and duplicate commits
      // when the user re-launches a plan whose earlier run was cancelled.
      const alreadyDonePromptIds = await this.loadAlreadyDonePromptIds(
        supabase,
        runRow.plan_id,
        this._runId,
      );
      if (alreadyDonePromptIds.size > 0) {
        this.logger.info(
          {
            runId: this._runId,
            planId: runRow.plan_id,
            count: alreadyDonePromptIds.size,
          },
          "skip-if-already-done: prompts to skip from prior runs",
        );
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
        alreadyDonePromptIds,
      });

      this.logger.info(
        { runId: this._runId, planId: runRow.plan_id, prompts: plan.prompts.length },
        "starting orchestrator",
      );

      // Bridge user-initiated pause/resume/cancel from the DB into the
      // in-memory orchestrator. Started right before .run() so the channel
      // is live for the entire execution window. Must be torn down in the
      // finally below regardless of how the run terminates.
      this.controlChannel = new RunControlChannel({
        runId: this._runId,
        supabaseUrl: this.supabaseUrl,
        supabaseServiceKey: this.supabaseServiceKey,
        logger: this.logger,
        onPause: () => {
          this.logger.info({ runId: this._runId }, "control: pause requested");
          this.orchestrator?.pause();
          void this.emitControlAck("worker.pause_ack").catch(() => {});
        },
        onResume: () => {
          this.logger.info({ runId: this._runId }, "control: resume requested");
          this.orchestrator?.resume();
          void this.emitControlAck("worker.resume_ack").catch(() => {});
        },
        onCancel: (reason: string) => {
          this.logger.info({ runId: this._runId, reason }, "control: cancel requested");
          this.orchestrator?.cancel(reason);
          void this.emitControlAck("worker.cancel_ack", { reason }).catch(() => {});
        },
      });
      try {
        await this.controlChannel.start();
      } catch (err) {
        // Realtime is best-effort. If subscribe throws we keep going —
        // graceful shutdown still covers the worst case.
        this.logger.warn(
          { runId: this._runId, err },
          "control channel failed to start; continuing without realtime",
        );
      }

      let result: RunResult | null = null;
      let orchestratorError: unknown = null;
      try {
        result = await this.orchestrator.run();
      } catch (err) {
        orchestratorError = err;
        this.logger.error({ err, runId: this._runId }, "orchestrator threw");
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
            this.logger.error(
              { err, runId: this._runId, runBranch: runInit?.runBranch },
              "failed to finalize checkpoint",
            );
          }
          try {
            await repoInitializer.restoreAfterRun(repoInitResult, runRow.working_dir);
          } catch (err) {
            this.logger.error({ runId: this._runId, err }, "failed to restore repo after run");
          }
        }

        // Write terminal status to DB so the run row doesn't get stuck in
        // `running`. Runs both on success (orchestrator returned a result)
        // and failure (orchestrator threw).
        await this.writeTerminalRunStatus(
          db,
          result,
          orchestratorError,
          runInit?.runBranch ?? null,
        );
      }

      if (result !== null) {
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
      }
    } finally {
      if (this.controlChannel !== null) {
        try {
          await this.controlChannel.stop();
        } catch (err) {
          this.logger.warn({ runId: this._runId, err }, "failed to stop control channel");
        }
        this.controlChannel = null;
      }
      if (this.heartbeat !== null) {
        try {
          await this.heartbeat.stop();
        } catch (err) {
          this.logger.warn({ runId: this._runId, err }, "failed to stop heartbeat");
        }
        this.heartbeat = null;
      }
      this.running = false;
      this.orchestrator = null;
    }
  }

  /**
   * Emit a `run_events` row acknowledging that the worker received and
   * actioned a user-initiated control signal. Lets the UI surface the
   * difference between "pause request sent" (DB status flipped) and
   * "worker actually paused" (which only happens at the next wave
   * boundary). Best-effort; failures are swallowed.
   */
  private async emitControlAck(
    eventType: "worker.pause_ack" | "worker.resume_ack" | "worker.cancel_ack",
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      const supabase = createClient(this.supabaseUrl, this.supabaseServiceKey);
      // run_events.sequence is unique per run; allocate via the same RPC
      // the API and orchestrator use so ordering is consistent.
      const { data: seq, error: seqErr } = await supabase.rpc("next_event_sequence", {
        p_run_id: this._runId,
      });
      if (seqErr !== null || typeof seq !== "number") {
        this.logger.debug(
          { runId: this._runId, eventType, err: seqErr },
          "control ack: failed to allocate sequence",
        );
        return;
      }
      await supabase.from("run_events").insert({
        run_id: this._runId,
        sequence: seq,
        event_type: eventType,
        payload: { ...payload, observed_at: new Date().toISOString() } as never,
      });
    } catch (err) {
      this.logger.debug({ runId: this._runId, eventType, err }, "control ack emit failed");
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
   * Write the terminal `runs` row status after the orchestrator finishes (or
   * throws). Runs in the post-orchestrator `finally`, so it must be best
   * effort: any DB error is logged but never rethrown. On success we also
   * clear `checkpoint_branch` (the run branch is deleted by `finishRun`),
   * but on failure we retain it so the user can inspect the branch.
   */
  private async writeTerminalRunStatus(
    db: DbClient,
    result: RunResult | null,
    orchestratorError: unknown,
    runBranch: string | null,
  ): Promise<void> {
    let status: "completed" | "failed" | "cancelled" = "failed";
    let cancellationReason: string | null = null;

    if (result !== null) {
      // Trust the orchestrator's reported status.
      if (result.status === "completed") status = "completed";
      else if (result.status === "cancelled") status = "cancelled";
      else status = "failed";
    } else if (orchestratorError !== null) {
      status = "failed";
      cancellationReason =
        orchestratorError instanceof Error
          ? orchestratorError.message.slice(0, 500)
          : String(orchestratorError).slice(0, 500);
    }

    const update: Record<string, unknown> = {
      status,
      finished_at: new Date().toISOString(),
    };

    // On success the run branch was merged + deleted by finishRun, so the
    // checkpoint_branch reference is dangling — clear it. On failure keep it
    // so the user can inspect the run branch.
    if (status === "completed") {
      update["checkpoint_branch"] = null;
    }

    if (cancellationReason !== null) {
      update["cancellation_reason"] = cancellationReason;
    }

    try {
      const { error } = await db.from("runs").update(update).eq("id", this._runId);
      if (error !== null && error !== undefined) {
        this.logger.error({ error, runId: this._runId }, "failed to write terminal run status");
      } else {
        this.logger.info({ runId: this._runId, status, runBranch }, "run finalized");
      }
    } catch (err) {
      this.logger.error({ err, runId: this._runId }, "failed to write terminal run status (threw)");
    }

    const audit = new AuditLogger(db as unknown as GuardianDbClient);
    if (status === "completed") {
      void audit.log({
        actor: "worker",
        action: "run.completed",
        resourceType: "run",
        resourceId: this._runId,
        metadata: { status },
      });
    } else if (status === "cancelled") {
      void audit.log({
        actor: "worker",
        action: "run.cancelled",
        resourceType: "run",
        resourceId: this._runId,
        metadata: { status },
      });
    } else {
      void audit.log({
        actor: "worker",
        action: "run.failed",
        resourceType: "run",
        resourceId: this._runId,
        metadata: { status },
      });
    }
  }

  /**
   * Best-effort transition of the `runs` row to `failed` status. Used when an
   * early failure (missing row, plan load error, etc.) prevents the
   * orchestrator from being constructed — without this update the row would
   * remain stuck in `running` forever.
   */
  private async markRunFailed(db: SupabaseClient, runId: string, reason: string): Promise<void> {
    try {
      // CAS guard: only flip to `failed` if the row is still `running`.
      // Without this, a sweep that already transitioned the run to
      // `paused` (crash recovery) gets stomped — turning a recoverable
      // run into a terminal one. The early-failure path (missing plan,
      // git init error) is the only caller, and in those cases the run
      // really is `running` (we just claimed it).
      await db
        .from("runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          cancellation_reason: reason.slice(0, 500),
        })
        .eq("id", runId)
        .eq("status", "running");
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

  /**
   * Returns the set of prompt ids that have at least one `succeeded`
   * `prompt_executions` row across any prior run of the same plan (excluding
   * the current run). Used by skip-if-already-done so the orchestrator can
   * avoid re-executing prompts that were already completed.
   *
   * Failures are logged and turned into an empty set — when in doubt we
   * prefer re-execution (correctness) over skipping (cost optimization).
   */
  private async loadAlreadyDonePromptIds(
    supabase: SupabaseClient,
    planId: string,
    currentRunId: string,
  ): Promise<Set<string>> {
    try {
      // 1) all run ids for this plan, excluding the current one.
      const { data: runRows, error: runErr } = await supabase
        .from("runs")
        .select("id")
        .eq("plan_id", planId)
        .neq("id", currentRunId);

      if (runErr !== null) {
        this.logger.warn(
          { planId, currentRunId, err: runErr },
          "skip-if-already-done: failed to list prior runs — will re-execute everything",
        );
        return new Set();
      }

      const priorRunIds = (runRows ?? [])
        .map((r) => (r as { id?: unknown }).id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

      if (priorRunIds.length === 0) return new Set();

      // 2) succeeded prompt_ids in those runs.
      const { data: peRows, error: peErr } = await supabase
        .from("prompt_executions")
        .select("prompt_id")
        .in("run_id", priorRunIds)
        .eq("status", "succeeded");

      if (peErr !== null) {
        this.logger.warn(
          { planId, currentRunId, err: peErr },
          "skip-if-already-done: failed to list succeeded prompts — will re-execute everything",
        );
        return new Set();
      }

      const ids = new Set<string>();
      for (const row of peRows ?? []) {
        const pid = (row as { prompt_id?: unknown }).prompt_id;
        if (typeof pid === "string" && pid.length > 0) ids.add(pid);
      }
      return ids;
    } catch (err) {
      this.logger.warn(
        { planId, currentRunId, err },
        "skip-if-already-done: query threw — will re-execute everything",
      );
      return new Set();
    }
  }
}

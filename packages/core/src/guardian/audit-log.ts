/**
 * Conductor — Guardian Audit Log
 *
 * Persists every Guardian decision to the `guardian_decisions` table so the
 * dashboard, post-mortem tooling, and analytics layer can audit what the
 * Guardian did during a run. The class is intentionally small and defensive:
 *
 *  - It never throws. All DB errors degrade to a logged warning and a soft
 *    failure surface in the return value (or an empty result for reads). The
 *    audit log is best-effort; we do not want a flaky DB to take down the
 *    Guardian's hot path.
 *
 *  - It is fire-and-forget friendly. {@link GuardianAuditLog.log} returns a
 *    Promise but is designed to be `.catch()`-handled by callers that don't
 *    want to await.
 *
 *  - It owns the camelCase ↔ snake_case mapping between the runtime types
 *    used by the Guardian module and the DB columns.
 */
import { type Logger, createLogger } from "../logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal DB client interface
//
// Mirrors the shape of @supabase/supabase-js's PostgrestQueryBuilder but kept
// purposely tiny so tests can stub it without importing the SDK. The shape is
// a strict superset of orchestrator's `DbClient` — we add `.in()`,
// `.order()`, and a `.then()` thenable for "list" queries.
// ─────────────────────────────────────────────────────────────────────────────

export interface DbSingleResult {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
}

export interface DbListResult {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}

export interface DbTable {
  insert(row: Record<string, unknown>): DbTable;
  update(data: Record<string, unknown>): DbTable;
  select(columns?: string): DbTable;
  eq(column: string, value: unknown): DbTable;
  in(column: string, values: unknown[]): DbTable;
  order(column: string, options?: { ascending?: boolean }): DbTable;
  single(): Promise<DbSingleResult>;
  /**
   * Awaiting a chain (without `.single()`) yields a list result. This mirrors
   * how PostgREST query builders are thenable in the Supabase JS SDK.
   */
  then<TResult1 = DbListResult, TResult2 = never>(
    onfulfilled?: ((value: DbListResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}

export interface DbClient {
  from(table: string): DbTable;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal data shape the runner hands to the audit log on every intervention.
 */
export interface GuardianDecisionRecord {
  /** FK to `prompt_executions.id`. */
  promptExecutionId: string;
  /** The verbatim question Guardian saw. */
  questionDetected: string;
  /** Up to 200 chars of context preceding the question, for triage. */
  contextSnippet?: string;
  /** The Guardian's chosen answer/decision. */
  decision: string;
  /** Why the strategy chose that decision. */
  reasoning: string;
  /** Confidence in [0, 1]. */
  confidence: number;
  /** Which strategy fired. */
  strategy: "rule" | "default" | "llm";
  /** Whether the dashboard should flag this row for human review. */
  requiresHumanReview: boolean;
}

/**
 * Result of a single {@link GuardianAuditLog.log} call. Never throws — always
 * resolves with `success: false` on error so callers can decide whether to
 * surface it.
 */
export interface AuditLogResult {
  /** UUID of the inserted row. Empty string on failure. */
  id: string;
  success: boolean;
  error?: string;
}

/**
 * Fully-hydrated row as returned by {@link GuardianAuditLog.getByExecution}.
 */
export interface GuardianDecisionRow extends GuardianDecisionRecord {
  id: string;
  /** Whether a human substituted their own answer for Guardian's. */
  overriddenByHuman: boolean;
  /** The human's substituted answer, when overridden. */
  overrideResponse?: string;
  /** ISO timestamp of insertion. */
  createdAt: string;
}

/**
 * Aggregate metrics computed by {@link GuardianAuditLog.getMetrics}.
 */
export interface GuardianMetrics {
  /** Total Guardian interventions in the run. */
  totalInterventions: number;
  /** Per-strategy intervention counts. */
  byStrategy: Record<"rule" | "default" | "llm", number>;
  /** Mean confidence across all interventions. 0 when there are none. */
  averageConfidence: number;
  /** Fraction of interventions overridden by a human, in [0, 1]. */
  overrideRate: number;
}

const TABLE = "guardian_decisions";
const PROMPT_EXECUTIONS_TABLE = "prompt_executions";

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persistence adapter for {@link GuardianDecisionRecord}s.
 *
 * One instance per orchestrator run is fine; the class is stateless beyond
 * its constructor-injected dependencies.
 */
export class GuardianAuditLog {
  private readonly logger: Logger;

  constructor(private readonly db: DbClient) {
    this.logger = createLogger("guardian:audit-log");
  }

  /**
   * Persist a single Guardian decision. Best-effort: returns a failure result
   * instead of throwing when the DB rejects the write so callers can use it
   * fire-and-forget.
   */
  async log(record: GuardianDecisionRecord): Promise<AuditLogResult> {
    const row: Record<string, unknown> = {
      prompt_execution_id: record.promptExecutionId,
      question_detected: record.questionDetected,
      decision: record.decision,
      reasoning: record.reasoning,
      confidence: record.confidence,
      strategy: record.strategy,
      requires_human_review: record.requiresHumanReview,
    };
    if (record.contextSnippet !== undefined) {
      row["context_snippet"] = record.contextSnippet.slice(0, 200);
    }

    try {
      const result = await this.db.from(TABLE).insert(row).select("id").single();
      if (result.error !== null) {
        this.logger.warn(
          { err: result.error.message, promptExecutionId: record.promptExecutionId },
          "guardian audit log insert failed",
        );
        return { id: "", success: false, error: result.error.message };
      }
      const id = typeof result.data?.["id"] === "string" ? result.data["id"] : "";
      return { id, success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { err: message, promptExecutionId: record.promptExecutionId },
        "guardian audit log insert threw",
      );
      return { id: "", success: false, error: message };
    }
  }

  /**
   * Returns every decision recorded for the given `promptExecutionId`,
   * ordered oldest → newest. Empty array on error.
   */
  async getByExecution(promptExecutionId: string): Promise<GuardianDecisionRow[]> {
    try {
      const result = await this.db
        .from(TABLE)
        .select("*")
        .eq("prompt_execution_id", promptExecutionId)
        .order("created_at", { ascending: true });

      if (result.error !== null) {
        this.logger.warn(
          { err: result.error.message, promptExecutionId },
          "guardian audit log read failed",
        );
        return [];
      }
      return (result.data ?? []).map(rowToDecision);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: message, promptExecutionId }, "guardian audit log read threw");
      return [];
    }
  }

  /**
   * Aggregate Guardian metrics across every prompt execution belonging to the
   * given `runId`. Two-step query because the {@link DbClient} interface is
   * deliberately narrow: first list `prompt_execution_id`s for the run, then
   * pull all decisions for those IDs.
   */
  async getMetrics(runId: string): Promise<GuardianMetrics> {
    const empty: GuardianMetrics = {
      totalInterventions: 0,
      byStrategy: { rule: 0, default: 0, llm: 0 },
      averageConfidence: 0,
      overrideRate: 0,
    };

    try {
      const executionsResult = await this.db
        .from(PROMPT_EXECUTIONS_TABLE)
        .select("id")
        .eq("run_id", runId);

      if (executionsResult.error !== null) {
        this.logger.warn(
          { err: executionsResult.error.message, runId },
          "guardian metrics: prompt_executions read failed",
        );
        return empty;
      }

      const executionIds = (executionsResult.data ?? [])
        .map((row) => row["id"])
        .filter((id): id is string => typeof id === "string");

      if (executionIds.length === 0) {
        return empty;
      }

      const decisionsResult = await this.db
        .from(TABLE)
        .select("strategy, confidence, overridden_by_human")
        .in("prompt_execution_id", executionIds);

      if (decisionsResult.error !== null) {
        this.logger.warn(
          { err: decisionsResult.error.message, runId },
          "guardian metrics: decisions read failed",
        );
        return empty;
      }

      const rows = decisionsResult.data ?? [];
      if (rows.length === 0) return empty;

      const byStrategy: Record<"rule" | "default" | "llm", number> = {
        rule: 0,
        default: 0,
        llm: 0,
      };
      let confidenceSum = 0;
      let overriddenCount = 0;

      for (const row of rows) {
        const strat = row["strategy"];
        if (strat === "rule" || strat === "default" || strat === "llm") {
          byStrategy[strat] += 1;
        }
        const conf = row["confidence"];
        if (typeof conf === "number") confidenceSum += conf;
        else if (typeof conf === "string") {
          const parsed = Number.parseFloat(conf);
          if (!Number.isNaN(parsed)) confidenceSum += parsed;
        }
        if (row["overridden_by_human"] === true) overriddenCount += 1;
      }

      return {
        totalInterventions: rows.length,
        byStrategy,
        averageConfidence: confidenceSum / rows.length,
        overrideRate: overriddenCount / rows.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: message, runId }, "guardian metrics threw");
      return empty;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function rowToDecision(row: Record<string, unknown>): GuardianDecisionRow {
  const strategy = row["strategy"];
  const safeStrategy: "rule" | "default" | "llm" =
    strategy === "rule" || strategy === "default" || strategy === "llm" ? strategy : "default";

  const confidenceRaw = row["confidence"];
  const confidence =
    typeof confidenceRaw === "number"
      ? confidenceRaw
      : typeof confidenceRaw === "string"
        ? Number.parseFloat(confidenceRaw)
        : 0;

  const decision: GuardianDecisionRow = {
    id: stringOr(row["id"], ""),
    promptExecutionId: stringOr(row["prompt_execution_id"], ""),
    questionDetected: stringOr(row["question_detected"], ""),
    decision: stringOr(row["decision"], ""),
    reasoning: stringOr(row["reasoning"], ""),
    confidence: Number.isFinite(confidence) ? confidence : 0,
    strategy: safeStrategy,
    requiresHumanReview: row["requires_human_review"] === true,
    overriddenByHuman: row["overridden_by_human"] === true,
    createdAt: stringOr(row["created_at"], ""),
  };

  const contextSnippet = row["context_snippet"];
  if (typeof contextSnippet === "string") decision.contextSnippet = contextSnippet;
  const overrideResponse = row["override_response"];
  if (typeof overrideResponse === "string") decision.overrideResponse = overrideResponse;

  return decision;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

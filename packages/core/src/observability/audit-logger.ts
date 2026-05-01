import type { DbClient } from "../guardian/audit-log.js";
/**
 * Conductor — System-wide Audit Logger
 *
 * General-purpose audit event logger that persists entries to the `audit_log`
 * table. Distinct from `guardian/audit-log.ts` which is Guardian-specific.
 *
 * Design principles (mirrors GuardianAuditLog):
 *  - Never throws. All DB errors degrade to a logged warning and a soft
 *    failure in the return value. The audit log is best-effort.
 *  - Fire-and-forget friendly: `log` can be awaited or `.catch()`-handled.
 *  - Owns camelCase ↔ snake_case mapping.
 */
import { type Logger, createLogger } from "../logger.js";

export type { DbClient };

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type AuditActor = "user" | "worker" | "guardian" | "system";

export type AuditAction =
  | "plan.created"
  | "plan.updated"
  | "plan.deleted"
  | "run.launched"
  | "run.cancelled"
  | "run.completed"
  | "run.failed"
  | "prompt.completed"
  | "prompt.failed"
  | "guardian.decision_made"
  | "token.saved"
  | "token.revoked"
  | "settings.updated"
  | "auth.login"
  | "auth.logout";

export type AuditResourceType =
  | "plan"
  | "run"
  | "prompt_execution"
  | "auth_token"
  | "settings"
  | "guardian_decision";

export interface AuditEntry {
  /** Undefined for system actors. */
  userId?: string;
  actor: AuditActor;
  action: AuditAction;
  resourceType?: AuditResourceType;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

export interface AuditLogResult {
  /** UUID of the inserted row. Empty string on failure. */
  id: string;
  success: boolean;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

const TABLE = "audit_log";

/**
 * System-wide audit event logger.
 *
 * One instance can be shared across the process; it is stateless beyond its
 * constructor-injected dependencies.
 */
export class AuditLogger {
  private readonly logger: Logger;

  constructor(private readonly db: DbClient) {
    this.logger = createLogger("observability:audit-logger");
  }

  /**
   * Persist a single audit event. Best-effort: returns `{success: false}` on
   * DB error instead of throwing so callers can use it fire-and-forget.
   */
  async log(entry: AuditEntry): Promise<AuditLogResult> {
    const row: Record<string, unknown> = {
      actor: entry.actor,
      action: entry.action,
    };

    if (entry.userId !== undefined) row["user_id"] = entry.userId;
    if (entry.resourceType !== undefined) row["resource_type"] = entry.resourceType;
    if (entry.resourceId !== undefined) row["resource_id"] = entry.resourceId;
    if (entry.metadata !== undefined) row["metadata"] = entry.metadata;
    if (entry.ipAddress !== undefined) row["ip_address"] = entry.ipAddress;

    try {
      const result = await this.db.from(TABLE).insert(row).select("id").single();
      if (result.error !== null) {
        this.logger.warn(
          { err: result.error.message, action: entry.action, actor: entry.actor },
          "audit log insert failed",
        );
        return { id: "", success: false, error: result.error.message };
      }
      const id =
        typeof result.data?.["id"] === "string"
          ? result.data["id"]
          : String(result.data?.["id"] ?? "");
      return { id, success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { err: message, action: entry.action, actor: entry.actor },
        "audit log insert threw",
      );
      return { id: "", success: false, error: message };
    }
  }
}

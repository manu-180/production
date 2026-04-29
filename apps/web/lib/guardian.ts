// Shared type (duplicated across API routes and page — centralize here)
export interface GuardianDecisionRow {
  id: string;
  promptExecutionId: string;
  questionDetected: string;
  contextSnippet?: string;
  decision: string;
  reasoning: string;
  confidence: number; // always 0-1, clamped
  strategy: "rule" | "default" | "llm";
  requiresHumanReview: boolean;
  overriddenByHuman: boolean;
  overrideResponse?: string;
  createdAt: string;
}

export interface GuardianMetrics {
  totalInterventions: number;
  byStrategy: Record<"rule" | "default" | "llm", number>;
  averageConfidence: number;
  overrideRate: number;
}

export const EMPTY_METRICS: GuardianMetrics = {
  totalInterventions: 0,
  byStrategy: { rule: 0, default: 0, llm: 0 },
  averageConfidence: 0,
  overrideRate: 0,
};

// Map a raw DB row (snake_case) to GuardianDecisionRow
export function mapDecisionRow(row: Record<string, unknown>): GuardianDecisionRow {
  const rawConfidence = row["confidence"];
  const confidence =
    typeof rawConfidence === "number"
      ? Math.min(1, Math.max(0, rawConfidence)) // clamp 0-1
      : 0;

  const rawStrategy = row["strategy"];
  const strategy: "rule" | "default" | "llm" = (["rule", "default", "llm"] as const).includes(
    rawStrategy as "rule" | "default" | "llm",
  )
    ? (rawStrategy as "rule" | "default" | "llm")
    : "llm";

  const rawContextSnippet = row["context_snippet"];
  const rawHumanOverride = row["human_override"];

  return {
    id: String(row["id"] ?? ""),
    promptExecutionId: String(row["prompt_execution_id"] ?? ""),
    questionDetected: String(row["question_detected"] ?? ""),
    contextSnippet: rawContextSnippet ? String(rawContextSnippet) : undefined,
    decision: String(row["decision"] ?? ""),
    reasoning: String(row["reasoning"] ?? ""),
    confidence,
    strategy,
    requiresHumanReview: row["requires_human_review"] === true,
    overriddenByHuman: row["reviewed_by_human"] === true, // null-safe: only true if explicitly true
    overrideResponse: rawHumanOverride ? String(rawHumanOverride) : undefined,
    createdAt: String(row["created_at"] ?? ""),
  };
}

// Compute metrics from an array of rows
export function computeMetrics(rows: GuardianDecisionRow[]): GuardianMetrics {
  if (rows.length === 0) return EMPTY_METRICS;

  const byStrategy = { rule: 0, default: 0, llm: 0 };
  let totalConfidence = 0;
  let overriddenCount = 0;

  for (const row of rows) {
    byStrategy[row.strategy]++;
    totalConfidence += row.confidence;
    if (row.overriddenByHuman) overriddenCount++;
  }

  return {
    totalInterventions: rows.length,
    byStrategy,
    averageConfidence: totalConfidence / rows.length,
    overrideRate: overriddenCount / rows.length,
  };
}

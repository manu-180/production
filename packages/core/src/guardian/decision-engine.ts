import { type Logger, createLogger } from "../logger.js";
import { DefaultsStrategy } from "./decision-strategies/strategy-defaults.js";
import { LlmStrategy } from "./decision-strategies/strategy-llm.js";
import { RulesStrategy } from "./decision-strategies/strategy-rules.js";

/**
 * Input passed into the decision engine for a single question.
 */
export interface DecisionInput {
  /** Extracted question text. */
  question: string;
  /** Detected options if any (e.g. from a numbered list). */
  options: string[] | null;
  /** Short summary of the current prompt context. */
  promptSummary?: string;
  /** Last 3 assistant messages, used to give the LLM strategy context. */
  recentAssistantMessages?: string[];
  /** Per-call Anthropic API key — overrides the engine-level key. */
  anthropicApiKey?: string;
}

/**
 * Result returned by the decision engine.
 */
export interface DecisionResult {
  /** The answer/decision text. */
  decision: string;
  /** Why this decision was made. */
  reasoning: string;
  /** Confidence in [0, 1]. */
  confidence: number;
  /** Which strategy produced the result. */
  strategy: "rule" | "default" | "llm";
  /** True when confidence is low enough that a human should double-check. */
  requiresHumanReview: boolean;
}

/**
 * Common interface implemented by every decision strategy. Returning `null`
 * means "I have nothing to say — try the next strategy".
 */
export interface DecisionStrategy {
  readonly name: string;
  resolve(input: DecisionInput): Promise<DecisionResult | null>;
}

interface DecisionEngineConfig {
  /** Anthropic API key forwarded to the LLM strategy. */
  anthropicApiKey?: string;
  /** Override the default strategy chain (mostly for tests). */
  strategies?: DecisionStrategy[];
}

const HUMAN_REVIEW_THRESHOLD = 0.7;

/**
 * Cascading resolver that tries each strategy in order:
 *
 *   rules → defaults → llm → safe fallback
 *
 * The first strategy that returns a non-null result wins. The safe fallback
 * is only used when every strategy declined — it always has confidence 0
 * and `requiresHumanReview: true`.
 */
export class DecisionEngine {
  private readonly logger: Logger;
  private readonly strategies: DecisionStrategy[];

  constructor(config?: DecisionEngineConfig) {
    this.logger = createLogger("guardian:decision-engine");
    if (config?.strategies && config.strategies.length > 0) {
      this.strategies = config.strategies;
    } else {
      this.strategies = [
        new RulesStrategy(),
        new DefaultsStrategy(),
        new LlmStrategy(
          config?.anthropicApiKey !== undefined
            ? { anthropicApiKey: config.anthropicApiKey }
            : undefined,
        ),
      ];
    }
  }

  /** Run the strategy chain. Always returns a result — never throws. */
  async resolve(input: DecisionInput): Promise<DecisionResult> {
    for (const strategy of this.strategies) {
      try {
        const result = await strategy.resolve(input);
        if (result) {
          this.logger.info(
            {
              strategy: strategy.name,
              decisionStrategy: result.strategy,
              confidence: result.confidence,
              requiresHumanReview: result.requiresHumanReview,
            },
            "decision resolved",
          );
          return this.normalize(result);
        }
        this.logger.debug({ strategy: strategy.name }, "strategy declined");
      } catch (err) {
        this.logger.error({ err, strategy: strategy.name }, "strategy threw — moving on");
      }
    }

    this.logger.warn("all strategies declined — returning safe fallback");
    return {
      decision: "Please decide — the Guardian could not determine the best answer",
      reasoning: "No matching rule, default, or LLM result",
      confidence: 0,
      strategy: "llm",
      requiresHumanReview: true,
    };
  }

  /**
   * Ensure `requiresHumanReview` is consistent with `confidence`. Strategies
   * are free to set it themselves, but we enforce the threshold here as a
   * safety net.
   */
  private normalize(result: DecisionResult): DecisionResult {
    const requiresHumanReview =
      result.requiresHumanReview || result.confidence < HUMAN_REVIEW_THRESHOLD;
    return { ...result, requiresHumanReview };
  }
}

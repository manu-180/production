/**
 * Conductor — Guardian Runner
 *
 * High-level glue that wires the {@link QuestionDetector} and the
 * {@link DecisionEngine} into the Orchestrator's prompt-execution loop. The
 * runner is the only Guardian surface the Orchestrator needs to know about.
 *
 * Responsibilities:
 *  - Run question detection on the last assistant message of a finished run.
 *  - When a question is detected, ask the {@link DecisionEngine} for an answer.
 *  - Track per-prompt intervention counts and stop when they exceed the
 *    configured ceiling so we never loop forever.
 *  - Build the follow-up text that the orchestrator should feed back into the
 *    Claude CLI as a resumed turn.
 *
 * The runner is intentionally stateless across prompts — the orchestrator owns
 * the per-prompt counter and passes it in on each call.
 */
import { type Logger, createLogger } from "../logger.js";
import { DecisionEngine, type DecisionInput, type DecisionResult } from "./decision-engine.js";
import {
  type DetectionInput,
  type DetectionResult,
  QuestionDetector,
} from "./question-detector.js";
import { SystemPromptInjector } from "./system-prompt-injector.js";

/**
 * Operating mode for the Guardian.
 *
 * - `auto`: detection + decision happen automatically; the orchestrator feeds
 *   the chosen answer back into Claude without human input.
 * - `confirm`: same flow as `auto` from the runner's point of view; the
 *   orchestrator/UI is responsible for surfacing a confirmation step before
 *   submitting the answer.
 * - `disabled`: the runner is a no-op.
 */
export type GuardianMode = "auto" | "confirm" | "disabled";

/**
 * Configuration accepted by {@link GuardianRunner}.
 */
export interface GuardianRunnerConfig {
  /** Anthropic API key forwarded to detection and decision strategies. */
  anthropicApiKey?: string;
  /**
   * Maximum number of times Guardian may auto-answer for a single prompt
   * before the orchestrator must fail with `GUARDIAN_LOOP`. Defaults to `5`.
   */
  maxGuardianInterventions?: number;
  /** Operating mode. Defaults to `'auto'`. */
  mode?: GuardianMode;
}

/**
 * Result returned by {@link GuardianRunner.checkAndDecide}.
 */
export interface GuardianInterventionResult {
  /** Whether the runner intervened on this turn. */
  intervened: boolean;
  /** The decision returned by the decision engine, when applicable. */
  decision?: DecisionResult;
  /** The detection result that triggered the intervention, when applicable. */
  detectionResult?: DetectionResult;
  /** Pre-built text the orchestrator should feed back as the next prompt. */
  guardianResponse?: string;
  /**
   * The intervention count after this call. Equals the input count when the
   * runner did not intervene; equals input + 1 when it did.
   */
  interventionCount: number;
  /**
   * True when the call was rejected because the intervention ceiling was hit.
   * The orchestrator should treat this as a terminal `GUARDIAN_LOOP` error.
   */
  loopLimitReached?: boolean;
  /** The configured mode at call time — useful for callers handling `confirm`. */
  mode: GuardianMode;
}

/**
 * Parameters accepted by {@link GuardianRunner.checkAndDecide}.
 */
export interface GuardianCheckParams {
  /** Last assistant message text from the executor run. */
  lastAssistantMessage: string;
  /** Stop reason emitted by Claude (e.g. `end_turn`, `tool_use`). */
  stopReason?: string;
  /** Whether the last assistant message contained a `tool_use` block. */
  hasToolUse?: boolean;
  /** Short summary of the current prompt (truncated to ~200 chars). */
  promptContext?: string;
  /** Last 3 assistant messages for richer LLM context. */
  recentMessages?: string[];
  /** How many times Guardian has already intervened on this prompt. */
  currentInterventionCount: number;
}

const DEFAULT_MAX_INTERVENTIONS = 5;
const DEFAULT_MODE: GuardianMode = "auto";

/**
 * Coordinates {@link QuestionDetector} and {@link DecisionEngine} on behalf of
 * the orchestrator. Construct once per run (or once per app) and reuse.
 */
export class GuardianRunner {
  private readonly logger: Logger;
  private readonly detector: QuestionDetector;
  private readonly engine: DecisionEngine;
  private readonly injector: SystemPromptInjector;
  private readonly maxInterventions: number;
  private readonly mode: GuardianMode;
  private readonly anthropicApiKey: string | undefined;

  constructor(config?: GuardianRunnerConfig) {
    this.logger = createLogger("guardian:runner");
    this.anthropicApiKey = config?.anthropicApiKey;
    this.maxInterventions = config?.maxGuardianInterventions ?? DEFAULT_MAX_INTERVENTIONS;
    this.mode = config?.mode ?? DEFAULT_MODE;

    const detectorConfig =
      this.anthropicApiKey !== undefined ? { anthropicApiKey: this.anthropicApiKey } : undefined;
    this.detector = new QuestionDetector(detectorConfig);

    const engineConfig =
      this.anthropicApiKey !== undefined ? { anthropicApiKey: this.anthropicApiKey } : undefined;
    this.engine = new DecisionEngine(engineConfig);

    this.injector = new SystemPromptInjector();
  }

  /** Returns the configured operating mode. */
  getMode(): GuardianMode {
    return this.mode;
  }

  /** Returns the configured intervention ceiling. */
  getMaxInterventions(): number {
    return this.maxInterventions;
  }

  /** Exposes the {@link SystemPromptInjector} so the orchestrator can inject. */
  getInjector(): SystemPromptInjector {
    return this.injector;
  }

  /**
   * Inspect the last turn of a Claude run and decide whether Guardian should
   * step in. When it should, build the follow-up prompt the orchestrator can
   * resume the session with.
   *
   * Always returns — never throws. Detection / decision failures degrade to
   * `intervened: false` so the orchestrator can finish the run normally.
   */
  async checkAndDecide(params: GuardianCheckParams): Promise<GuardianInterventionResult> {
    if (this.mode === "disabled") {
      return {
        intervened: false,
        interventionCount: params.currentInterventionCount,
        mode: this.mode,
      };
    }

    if (params.currentInterventionCount >= this.maxInterventions) {
      this.logger.warn(
        {
          currentInterventionCount: params.currentInterventionCount,
          maxInterventions: this.maxInterventions,
        },
        "GUARDIAN_LOOP: max interventions reached",
      );
      return {
        intervened: false,
        interventionCount: params.currentInterventionCount,
        loopLimitReached: true,
        mode: this.mode,
      };
    }

    const detectionInput: DetectionInput = {
      lastAssistantMessage: params.lastAssistantMessage,
    };
    if (params.stopReason !== undefined) detectionInput.stopReason = params.stopReason;
    if (params.hasToolUse !== undefined) detectionInput.hasToolUseInLastMessage = params.hasToolUse;
    if (this.anthropicApiKey !== undefined) detectionInput.anthropicApiKey = this.anthropicApiKey;

    let detection: DetectionResult;
    try {
      detection = await this.detector.detect(detectionInput);
    } catch (err) {
      this.logger.error({ err }, "question detector threw — skipping Guardian intervention");
      return {
        intervened: false,
        interventionCount: params.currentInterventionCount,
        mode: this.mode,
      };
    }

    if (!detection.isQuestion) {
      return {
        intervened: false,
        detectionResult: detection,
        interventionCount: params.currentInterventionCount,
        mode: this.mode,
      };
    }

    const question = detection.extractedQuestion ?? params.lastAssistantMessage;

    const decisionInput: DecisionInput = {
      question,
      options: detection.options,
    };
    if (params.promptContext !== undefined) decisionInput.promptSummary = params.promptContext;
    if (params.recentMessages !== undefined)
      decisionInput.recentAssistantMessages = params.recentMessages;
    if (this.anthropicApiKey !== undefined) decisionInput.anthropicApiKey = this.anthropicApiKey;

    let decision: DecisionResult;
    try {
      decision = await this.engine.resolve(decisionInput);
    } catch (err) {
      // DecisionEngine is supposed to never throw, but be defensive.
      this.logger.error({ err }, "decision engine threw — skipping Guardian intervention");
      return {
        intervened: false,
        detectionResult: detection,
        interventionCount: params.currentInterventionCount,
        mode: this.mode,
      };
    }

    const guardianResponse = `[Guardian auto-decision] ${decision.decision}\n\nReasoning: ${decision.reasoning}`;

    const nextCount = params.currentInterventionCount + 1;
    this.logger.info(
      {
        questionDetected: question,
        decision: decision.decision,
        confidence: decision.confidence,
        strategy: decision.strategy,
        interventionCount: nextCount,
      },
      "Guardian intervened",
    );

    return {
      intervened: true,
      decision,
      detectionResult: detection,
      guardianResponse,
      interventionCount: nextCount,
      mode: this.mode,
    };
  }
}

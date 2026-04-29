import Anthropic from "@anthropic-ai/sdk";
import { type Logger, createLogger } from "../logger";

/**
 * Input for the question detector.
 */
export interface DetectionInput {
  /** Raw text of the last assistant message. */
  lastAssistantMessage: string;
  /** Stop reason emitted by Claude (e.g. "end_turn", "tool_use", "max_tokens"). */
  stopReason?: string;
  /** Whether the last message contained a tool_use block. */
  hasToolUseInLastMessage?: boolean;
  /** Optional override for the Anthropic API key (otherwise the constructor key is used). */
  anthropicApiKey?: string;
}

/**
 * Result returned by the question detector.
 */
export interface DetectionResult {
  /** Whether the last message is asking the human for input. */
  isQuestion: boolean;
  /** Confidence in [0, 1]. */
  confidence: number;
  /** Question text extracted from the message, if any. */
  extractedQuestion: string | null;
  /** Discrete options offered by the assistant, if any. */
  options: string[] | null;
  /** Detection method that produced the verdict. */
  detectionMethod: "heuristic" | "llm" | "heuristic+llm";
  /** Heuristic score in [0, 1] computed in step 1. */
  heuristicScore: number;
}

interface QuestionDetectorConfig {
  /** Anthropic API key for the optional LLM step. */
  anthropicApiKey?: string;
  /** LLM model id used for ambiguous cases. */
  llmModel?: string;
}

/** Schema-shaped object returned by the LLM step. */
interface LlmJsonResponse {
  isQuestion: boolean;
  extractedQuestion: string | null;
  options: string[] | null;
  confidence: number;
}

const DEFAULT_LLM_MODEL = "claude-haiku-4-5";
const FALLBACK_LLM_MODEL = "claude-3-5-haiku-20241022";

const HIGH_CONFIDENCE_THRESHOLD = 0.6;
const LOW_CONFIDENCE_THRESHOLD = 0.3;

const QUESTION_PATTERNS: readonly RegExp[] = [
  /\bshould\s+i\b/i,
  /\bwould\s+you\s+like\b/i,
  /\bdo\s+you\s+want\b/i,
  /\bplease\s+confirm\b/i,
  /\bwhich\s+option\b/i,
  /\bqu[eé]\s+prefer[íi]s\b/i,
  /\bte\s+parece\b/i,
  /\bshall\s+i\b/i,
  /\bcould\s+you\b/i,
  /\bwhat\s+would\s+you\b/i,
];

const SYSTEM_PROMPT =
  'You are a question detector. Given the last assistant message, determine if it\'s asking the human for input/decision. Respond ONLY with valid JSON: {"isQuestion": boolean, "extractedQuestion": string | null, "options": string[] | null, "confidence": number}';

/**
 * Detects whether the last assistant message of a Claude run is a question
 * waiting for human input. Uses a fast heuristic score first; only falls back
 * to an LLM call when the score is in an ambiguous band.
 */
export class QuestionDetector {
  private readonly logger: Logger;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private clientCache: Anthropic | undefined;

  constructor(config?: QuestionDetectorConfig) {
    this.logger = createLogger("guardian:question-detector");
    this.apiKey = config?.anthropicApiKey;
    this.model = config?.llmModel ?? DEFAULT_LLM_MODEL;
  }

  /**
   * Run detection for the given input.
   *
   * - score > 0.6 → returns immediately as `isQuestion: true`.
   * - score < 0.3 → returns immediately as `isQuestion: false`.
   * - 0.3 ≤ score ≤ 0.6 → calls the LLM if an API key is available;
   *   otherwise degrades gracefully to the heuristic verdict.
   */
  async detect(input: DetectionInput): Promise<DetectionResult> {
    const heuristicScore = this.computeHeuristicScore(input);

    if (heuristicScore > HIGH_CONFIDENCE_THRESHOLD) {
      this.logger.debug(
        { heuristicScore, decision: "high-confidence-question" },
        "heuristic shortcut: question",
      );
      return {
        isQuestion: true,
        confidence: heuristicScore,
        extractedQuestion: extractLikelyQuestion(input.lastAssistantMessage),
        options: extractOptions(input.lastAssistantMessage),
        detectionMethod: "heuristic",
        heuristicScore,
      };
    }

    if (heuristicScore < LOW_CONFIDENCE_THRESHOLD) {
      this.logger.debug(
        { heuristicScore, decision: "high-confidence-not-question" },
        "heuristic shortcut: not a question",
      );
      return {
        isQuestion: false,
        confidence: 1 - heuristicScore,
        extractedQuestion: null,
        options: null,
        detectionMethod: "heuristic",
        heuristicScore,
      };
    }

    const apiKey = input.anthropicApiKey ?? this.apiKey;
    if (!apiKey) {
      this.logger.warn(
        { heuristicScore },
        "ambiguous heuristic score and no API key — degrading to heuristic verdict",
      );
      const isQuestion = heuristicScore >= 0.5;
      return {
        isQuestion,
        confidence: heuristicScore,
        extractedQuestion: isQuestion ? extractLikelyQuestion(input.lastAssistantMessage) : null,
        options: isQuestion ? extractOptions(input.lastAssistantMessage) : null,
        detectionMethod: "heuristic",
        heuristicScore,
      };
    }

    this.logger.debug(
      { heuristicScore, model: this.model },
      "ambiguous heuristic score — falling back to LLM",
    );

    const llmResult = await this.callLlm(input.lastAssistantMessage);

    const isQuestion = llmResult.isQuestion ?? false;
    const llmConfidence = clamp01(llmResult.confidence ?? 0.5);

    return {
      isQuestion,
      confidence: llmConfidence,
      extractedQuestion: llmResult.extractedQuestion ?? null,
      options: llmResult.options ?? null,
      detectionMethod: "heuristic+llm",
      heuristicScore,
    };
  }

  /**
   * Compute a fast 0–1 heuristic score for whether the message looks like
   * a question waiting for human input.
   */
  private computeHeuristicScore(input: DetectionInput): number {
    const message = input.lastAssistantMessage ?? "";
    if (message.trim().length === 0) {
      return 0;
    }

    let score = 0;

    if (endsWithQuestionMark(message)) {
      score += 0.35;
    }

    if (QUESTION_PATTERNS.some((re) => re.test(message))) {
      score += 0.3;
    }

    if (hasNumberedListInLastNLines(message, 5, 2)) {
      score += 0.25;
    }

    if (hasOrBetweenOptionsInSentence(message)) {
      score += 0.15;
    }

    if (input.stopReason === "end_turn" && input.hasToolUseInLastMessage === false) {
      score += 0.1;
    }

    return clamp01(score);
  }

  /**
   * Call the LLM to disambiguate. Returns a partial result populated from
   * the parsed JSON. Any failure returns `{ isQuestion: false }` so the
   * caller can degrade gracefully.
   */
  private async callLlm(message: string): Promise<Partial<DetectionResult>> {
    const client = this.getClient(this.apiKey);

    const tryOnce = async (model: string): Promise<Partial<DetectionResult>> => {
      const response = await client.messages.create({
        model,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: message,
          },
        ],
      });

      const text = extractTextFromResponse(response);
      const parsed = safeParseJson(text);
      if (!parsed) {
        this.logger.warn({ text }, "LLM response was not valid JSON");
        return { isQuestion: false };
      }

      return {
        isQuestion: Boolean(parsed.isQuestion),
        extractedQuestion: parsed.extractedQuestion ?? null,
        options: parsed.options ?? null,
        confidence: clamp01(typeof parsed.confidence === "number" ? parsed.confidence : 0.5),
      };
    };

    try {
      return await tryOnce(this.model);
    } catch (err) {
      const fallbackEligible = this.model === DEFAULT_LLM_MODEL;
      this.logger.warn({ err, model: this.model, fallbackEligible }, "LLM call failed");
      if (fallbackEligible) {
        try {
          return await tryOnce(FALLBACK_LLM_MODEL);
        } catch (fallbackErr) {
          this.logger.error(
            { err: fallbackErr, model: FALLBACK_LLM_MODEL },
            "LLM fallback model also failed",
          );
        }
      }
      return { isQuestion: false };
    }
  }

  private getClient(apiKey: string | undefined): Anthropic {
    if (this.clientCache) {
      return this.clientCache;
    }
    const client = new Anthropic({ apiKey });
    this.clientCache = client;
    return client;
  }
}

// --- helpers ---------------------------------------------------------------

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function endsWithQuestionMark(message: string): boolean {
  const trimmed = message.trimEnd();
  if (trimmed.length === 0) return false;
  // Look at the last sentence — strip trailing whitespace and quote-like chars.
  const stripped = trimmed.replace(/[\s"'`)\]]+$/u, "");
  return stripped.endsWith("?") || stripped.endsWith("？");
}

/**
 * Returns true when the last `lastN` non-empty lines contain at least
 * `minItems` numbered-list entries (e.g. `1.`, `2.`, `3.`).
 */
function hasNumberedListInLastNLines(message: string, lastN: number, minItems: number): boolean {
  const lines = message
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const tail = lines.slice(-lastN);
  const numbered = tail.filter((l) => /^\d+[.)]\s+\S/.test(l));
  return numbered.length >= minItems;
}

/**
 * Returns true when any sentence contains the form `X or Y`, suggesting two
 * mutually-exclusive options. Heuristic: a sentence with " or " surrounded by
 * non-trivial words on both sides.
 */
function hasOrBetweenOptionsInSentence(message: string): boolean {
  const sentences = message.split(/(?<=[.!?])\s+/u);
  return sentences.some((s) => /\b\w[\w/-]{1,}\s+or\s+\w[\w/-]{1,}\b/i.test(s));
}

/**
 * Extract the most likely question sentence: the last sentence that ends with
 * `?` if any; otherwise null.
 */
function extractLikelyQuestion(message: string): string | null {
  const sentences = message
    .split(/(?<=[.!?])\s+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (let i = sentences.length - 1; i >= 0; i--) {
    const s = sentences[i];
    if (s && /[?？]\s*[)"'`\]]*$/u.test(s)) {
      return s;
    }
  }
  return null;
}

/**
 * Extract numbered-list options from the message tail (best effort).
 */
function extractOptions(message: string): string[] | null {
  const lines = message.split(/\r?\n/).map((l) => l.trim());
  const items: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\d+[.)]\s+(.+)$/);
    if (match?.[1]) {
      items.push(match[1].trim());
    }
  }
  return items.length >= 2 ? items : null;
}

function safeParseJson(text: string): LlmJsonResponse | null {
  if (!text) return null;
  // Be tolerant: the model may wrap JSON in code fences or prose.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (fenceMatch?.[1]) candidates.push(fenceMatch[1]);
  const braceMatch = text.match(/\{[\s\S]*\}/u);
  if (braceMatch) candidates.push(braceMatch[0]);
  candidates.push(text);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim()) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        "isQuestion" in (parsed as Record<string, unknown>)
      ) {
        const obj = parsed as Record<string, unknown>;
        return {
          isQuestion: Boolean(obj["isQuestion"]),
          extractedQuestion:
            typeof obj["extractedQuestion"] === "string"
              ? (obj["extractedQuestion"] as string)
              : null,
          options: Array.isArray(obj["options"])
            ? (obj["options"] as unknown[]).filter((x): x is string => typeof x === "string")
            : null,
          confidence: typeof obj["confidence"] === "number" ? (obj["confidence"] as number) : 0.5,
        };
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Extract concatenated text from an Anthropic Messages API response.
 */
function extractTextFromResponse(response: Anthropic.Message): string {
  const parts: string[] = [];
  for (const block of response.content) {
    if (block.type === "text") {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

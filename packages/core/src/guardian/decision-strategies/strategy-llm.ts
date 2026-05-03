import Anthropic from "@anthropic-ai/sdk";
import { type Logger, createLogger } from "../../logger.js";
import type { DecisionInput, DecisionResult, DecisionStrategy } from "../decision-engine.js";

const DEFAULT_LLM_MODEL = "claude-sonnet-4-5";
const FALLBACK_LLM_MODEL = "claude-3-5-sonnet-20241022";
const LLM_TIMEOUT_MS = 15_000;
const HUMAN_REVIEW_THRESHOLD = 0.7;

const SYSTEM_PROMPT = [
  "You are a technical architect making decisions for a solo developer.",
  "Tech stack: Next.js 15 + TypeScript strict + Tailwind + shadcn/ui (web), Flutter + Riverpod (mobile), Supabase (DB + auth), Vitest (tests).",
  "Principles: simplicity, scalability, maintainability, pragmatism. Work directly on main branch, no branching.",
  'NEVER say "it depends" — always pick ONE option and justify it in 2 sentences max.',
  'Respond ONLY with valid JSON: {"decision": string, "reasoning": string, "confidence": number}',
].join("\n");

interface LlmJsonResponse {
  decision: string;
  reasoning: string;
  confidence: number;
}

interface StrategyLlmConfig {
  /** Anthropic API key — overrides the per-call key from `DecisionInput`. */
  anthropicApiKey?: string;
  /** Override the default model id (`claude-sonnet-4-5`). */
  llmModel?: string;
}

/**
 * Last-resort strategy: ask Claude Sonnet for a decision. Returns `null` on
 * timeout or unparseable output so the engine can fall back to its safe
 * default.
 */
export class LlmStrategy implements DecisionStrategy {
  public readonly name = "llm";
  private readonly logger: Logger;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly clientCache: Map<string, Anthropic> = new Map();

  constructor(config?: StrategyLlmConfig) {
    this.logger = createLogger("guardian:strategy-llm");
    this.apiKey = config?.anthropicApiKey;
    this.model = config?.llmModel ?? DEFAULT_LLM_MODEL;
  }

  async resolve(input: DecisionInput): Promise<DecisionResult | null> {
    const apiKey = input.anthropicApiKey ?? this.apiKey;
    if (!apiKey) {
      this.logger.warn("no Anthropic API key available — skipping LLM strategy");
      return null;
    }

    const userMessage = buildUserMessage(input);
    const client = this.getClient(apiKey);

    const tryOnce = async (model: string): Promise<DecisionResult | null> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
      try {
        const response = await client.messages.create(
          {
            model,
            max_tokens: 512,
            system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content: userMessage }],
          },
          { signal: controller.signal },
        );

        const text = extractTextFromResponse(response);
        const parsed = safeParseJson(text);
        if (!parsed) {
          this.logger.warn({ text }, "LLM strategy response was not valid JSON");
          return null;
        }

        const confidence = clamp01(parsed.confidence);
        return {
          decision: parsed.decision,
          reasoning: parsed.reasoning,
          confidence,
          strategy: "llm",
          requiresHumanReview: confidence < HUMAN_REVIEW_THRESHOLD,
        };
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          this.logger.warn({ model }, "LLM strategy timed out");
          return null;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      return await tryOnce(this.model);
    } catch (err) {
      const fallbackEligible = this.model === DEFAULT_LLM_MODEL;
      this.logger.warn({ err, model: this.model, fallbackEligible }, "LLM strategy call failed");
      if (fallbackEligible) {
        try {
          return await tryOnce(FALLBACK_LLM_MODEL);
        } catch (fallbackErr) {
          this.logger.error(
            { err: fallbackErr, model: FALLBACK_LLM_MODEL },
            "LLM strategy fallback model also failed",
          );
        }
      }
      return null;
    }
  }

  private getClient(apiKey: string): Anthropic {
    const cached = this.clientCache.get(apiKey);
    if (cached) return cached;
    const client = new Anthropic({ apiKey });
    this.clientCache.set(apiKey, client);
    return client;
  }
}

// --- helpers ---------------------------------------------------------------

function buildUserMessage(input: DecisionInput): string {
  const optionsLine =
    input.options && input.options.length > 0 ? input.options.join(" | ") : "none";
  const contextLine =
    input.recentAssistantMessages && input.recentAssistantMessages.length > 0
      ? input.recentAssistantMessages.join("\n---\n")
      : "none";
  const summaryLine = input.promptSummary ? `\nPrompt summary: ${input.promptSummary}` : "";
  return `Question: ${input.question}\nOptions: ${optionsLine}\nRecent context: ${contextLine}${summaryLine}`;
}

function clamp01(n: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function extractTextFromResponse(response: Anthropic.Message): string {
  const parts: string[] = [];
  for (const block of response.content) {
    if (block.type === "text") {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

function safeParseJson(text: string): LlmJsonResponse | null {
  if (!text) return null;

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (fenceMatch?.[1]) candidates.push(fenceMatch[1]);
  const braceMatch = text.match(/\{[\s\S]*\}/u);
  if (braceMatch) candidates.push(braceMatch[0]);
  candidates.push(text);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim()) as unknown;
      if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        const decision = obj["decision"];
        const reasoning = obj["reasoning"];
        const confidence = obj["confidence"];
        if (
          typeof decision === "string" &&
          decision.length > 0 &&
          typeof reasoning === "string" &&
          typeof confidence === "number"
        ) {
          return { decision, reasoning, confidence };
        }
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

import { type Logger, createLogger } from "../../logger.js";
import type { DecisionInput, DecisionResult, DecisionStrategy } from "../decision-engine.js";

/** A single hard-coded best-practice default. */
interface DefaultEntry {
  /** Case-insensitive regex matched against the question text. */
  pattern: RegExp;
  /** Decision text to return on match. */
  decision: string;
  /** Human-readable reasoning surfaced on the result. */
  reasoning: string;
}

/**
 * Best-practice defaults derived from CLAUDE.md and project conventions.
 * Order matters — the first match wins.
 */
const DEFAULTS: readonly DefaultEntry[] = [
  {
    pattern: /typescript.*javascript|javascript.*typescript|\bts\b.*\bjs\b|\bjs\b.*\bts\b/i,
    decision: "TypeScript with strict mode",
    reasoning: "Standard for type safety and maintainability",
  },
  {
    pattern: /rest.*graphql|graphql.*rest/i,
    decision:
      "REST API — unless the project explicitly needs real-time subscriptions or a complex graph of relationships",
    reasoning: "REST is simpler and more cacheable for most use cases",
  },
  {
    pattern: /tailwind.*css-in-js|css-in-js.*tailwind/i,
    decision: "Tailwind CSS",
    reasoning: "Per project stack (CLAUDE.md)",
  },
  {
    pattern: /supabase/i,
    decision: "Supabase",
    reasoning: "Per project stack (CLAUDE.md)",
  },
  {
    pattern: /flutter.*react native|react native.*flutter/i,
    decision: "Flutter with Riverpod",
    reasoning: "Per project stack (CLAUDE.md)",
  },
  {
    pattern: /web framework|frontend framework/i,
    decision: "Next.js 15 with TypeScript strict",
    reasoning: "Per project stack (CLAUDE.md)",
  },
  {
    pattern: /should i write tests|add tests|write tests/i,
    decision: "Yes — follow TDD: write tests first",
    reasoning: "Quality and maintainability",
  },
  {
    pattern: /branch name|create.*branch|new branch/i,
    decision: "Work directly on main — no branches",
    reasoning: "Single developer workflow",
  },
  {
    pattern: /naming convention|file.*name|name.*file/i,
    decision: "kebab-case for files, PascalCase for React components, camelCase for utils",
    reasoning: "Per project conventions",
  },
  {
    pattern: /state management/i,
    decision: "Zustand for web, Riverpod for Flutter",
    reasoning: "Per project stack",
  },
  {
    pattern: /auth.*provider|authentication/i,
    decision: "Supabase Auth",
    reasoning: "Per project stack",
  },
  {
    pattern: /\bdeploy\b|hosting/i,
    decision: "Vercel for web apps, Docker for self-hosted services",
    reasoning: "Per project stack",
  },
  {
    pattern: /database.*choice|which.*database|sql.*nosql|nosql.*sql/i,
    decision: "PostgreSQL via Supabase",
    reasoning: "Per project stack",
  },
  {
    pattern: /mobile.*framework|app.*framework/i,
    decision: "Flutter with Riverpod",
    reasoning: "Per project stack",
  },
];

const DEFAULT_CONFIDENCE = 0.95;

/**
 * Strategy that returns a hard-coded best-practice answer for common
 * architectural questions. Intentionally conservative — only matches when
 * the question is unambiguous.
 */
export class DefaultsStrategy implements DecisionStrategy {
  public readonly name = "defaults";
  private readonly logger: Logger;

  constructor() {
    this.logger = createLogger("guardian:strategy-defaults");
  }

  async resolve(input: DecisionInput): Promise<DecisionResult | null> {
    const question = input.question ?? "";
    if (question.trim().length === 0) {
      return null;
    }

    for (const entry of DEFAULTS) {
      if (entry.pattern.test(question)) {
        this.logger.debug(
          { pattern: entry.pattern.source, decision: entry.decision },
          "matched default",
        );
        return {
          decision: entry.decision,
          reasoning: entry.reasoning,
          confidence: DEFAULT_CONFIDENCE,
          strategy: "default",
          requiresHumanReview: false,
        };
      }
    }
    return null;
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

const sdkMock = vi.hoisted(() => {
  const messagesCreate = vi.fn();
  const AnthropicCtor = vi.fn().mockImplementation(() => ({
    messages: { create: messagesCreate },
  }));
  return { messagesCreate, AnthropicCtor };
});

vi.mock("@anthropic-ai/sdk", () => ({
  default: sdkMock.AnthropicCtor,
}));

const fsMock = vi.hoisted(() => ({
  readFileSync: vi.fn<(path: string, encoding: string) => string>(),
}));

vi.mock("node:fs", () => ({
  readFileSync: fsMock.readFileSync,
}));

import type { DecisionInput } from "../decision-engine.js";
import { DefaultsStrategy } from "../decision-strategies/strategy-defaults.js";
import { LlmStrategy } from "../decision-strategies/strategy-llm.js";
import { RulesStrategy } from "../decision-strategies/strategy-rules.js";

beforeEach(() => {
  sdkMock.messagesCreate.mockReset();
  sdkMock.AnthropicCtor.mockClear();
  fsMock.readFileSync.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// DefaultsStrategy
// ---------------------------------------------------------------------------

describe("DefaultsStrategy", () => {
  const cases: Array<{ q: string; mustInclude: string }> = [
    { q: "Should I use TypeScript or JavaScript?", mustInclude: "TypeScript" },
    { q: "TS or JS for this?", mustInclude: "TypeScript" },
    { q: "REST or GraphQL?", mustInclude: "REST" },
    { q: "Tailwind or css-in-js?", mustInclude: "Tailwind" },
    { q: "Should I use Supabase here?", mustInclude: "Supabase" },
    { q: "Flutter or React Native?", mustInclude: "Flutter" },
    { q: "Which web framework should I pick?", mustInclude: "Next.js" },
    { q: "Should I write tests for this?", mustInclude: "TDD" },
    { q: "What branch name should I use?", mustInclude: "main" },
    { q: "What naming convention should I follow?", mustInclude: "kebab-case" },
    { q: "Which state management library?", mustInclude: "Zustand" },
    { q: "Which auth provider should I use?", mustInclude: "Supabase Auth" },
    { q: "Where should I deploy this?", mustInclude: "Vercel" },
    { q: "Which database should I pick — SQL or NoSQL?", mustInclude: "PostgreSQL" },
    { q: "Which mobile framework?", mustInclude: "Flutter" },
  ];

  for (const c of cases) {
    it(`returns a default for: "${c.q}"`, async () => {
      const strat = new DefaultsStrategy();
      const result = await strat.resolve({ question: c.q, options: null });
      expect(result).not.toBeNull();
      expect(result?.confidence).toBe(0.95);
      expect(result?.strategy).toBe("default");
      expect(result?.requiresHumanReview).toBe(false);
      expect(result?.decision).toContain(c.mustInclude);
    });
  }

  it("returns null for unrecognized questions", async () => {
    const strat = new DefaultsStrategy();
    const result = await strat.resolve({
      question: "What's the airspeed velocity of an unladen swallow?",
      options: null,
    });
    expect(result).toBeNull();
  });

  it("returns null for empty/whitespace question", async () => {
    const strat = new DefaultsStrategy();
    expect(await strat.resolve({ question: "", options: null })).toBeNull();
    expect(await strat.resolve({ question: "   ", options: null })).toBeNull();
  });

  it("matches case-insensitively", async () => {
    const strat = new DefaultsStrategy();
    const upper = await strat.resolve({
      question: "SHOULD I USE TYPESCRIPT OR JAVASCRIPT?",
      options: null,
    });
    const lower = await strat.resolve({
      question: "should i use typescript or javascript?",
      options: null,
    });
    expect(upper).not.toBeNull();
    expect(lower).not.toBeNull();
    expect(upper?.decision).toBe(lower?.decision);
  });
});

// ---------------------------------------------------------------------------
// RulesStrategy
// ---------------------------------------------------------------------------

describe("RulesStrategy", () => {
  it("returns null when rules.yaml does not exist (ENOENT)", async () => {
    const enoent = Object.assign(new Error("not found"), { code: "ENOENT" });
    fsMock.readFileSync.mockImplementationOnce(() => {
      throw enoent;
    });

    const strat = new RulesStrategy("/tmp/nope.yaml");
    const result = await strat.resolve({ question: "anything", options: null });
    expect(result).toBeNull();
  });

  it("returns matching result for substring `match` rule", async () => {
    fsMock.readFileSync.mockReturnValueOnce(
      ["rules:", "  - match: 'TypeScript'", "    answer: 'Use TypeScript strict'"].join("\n"),
    );

    const strat = new RulesStrategy("/tmp/rules.yaml");
    const result = await strat.resolve({
      question: "Should I use TypeScript or JavaScript?",
      options: null,
    });
    expect(result).not.toBeNull();
    expect(result?.strategy).toBe("rule");
    expect(result?.confidence).toBe(1);
    expect(result?.requiresHumanReview).toBe(false);
    expect(result?.decision).toBe("Use TypeScript strict");
  });

  it("substring match is case-insensitive", async () => {
    fsMock.readFileSync.mockReturnValueOnce(
      ["rules:", "  - match: 'typescript'", "    answer: 'Use TS'"].join("\n"),
    );
    const strat = new RulesStrategy("/tmp/rules.yaml");
    const result = await strat.resolve({
      question: "Should I prefer TYPESCRIPT here?",
      options: null,
    });
    expect(result?.decision).toBe("Use TS");
  });

  it("returns matching result for `matchPattern` regex rule", async () => {
    fsMock.readFileSync.mockReturnValueOnce(
      [
        "rules:",
        "  - matchPattern: '^should i.*tests'",
        "    answer: 'Yes — write tests first'",
      ].join("\n"),
    );

    const strat = new RulesStrategy("/tmp/rules.yaml");
    const result = await strat.resolve({
      question: "Should I add tests for this function?",
      options: null,
    });
    expect(result).not.toBeNull();
    expect(result?.strategy).toBe("rule");
    expect(result?.decision).toBe("Yes — write tests first");
  });

  it("returns null when no rule matches", async () => {
    fsMock.readFileSync.mockReturnValueOnce(
      ["rules:", "  - match: 'GraphQL'", "    answer: 'Use REST instead'"].join("\n"),
    );

    const strat = new RulesStrategy("/tmp/rules.yaml");
    const result = await strat.resolve({
      question: "Should I use TypeScript?",
      options: null,
    });
    expect(result).toBeNull();
  });

  it("substring matches take precedence over regex matches", async () => {
    fsMock.readFileSync.mockReturnValueOnce(
      [
        "rules:",
        "  - matchPattern: 'foo'",
        "    answer: 'regex answer'",
        "  - match: 'foo'",
        "    answer: 'substring answer'",
      ].join("\n"),
    );

    const strat = new RulesStrategy("/tmp/rules.yaml");
    const result = await strat.resolve({ question: "foo bar", options: null });
    expect(result?.decision).toBe("substring answer");
  });

  it("handles invalid YAML gracefully (returns null)", async () => {
    fsMock.readFileSync.mockReturnValueOnce("rules: [unterminated\n  - bad");

    const strat = new RulesStrategy("/tmp/rules.yaml");
    const result = await strat.resolve({ question: "anything", options: null });
    expect(result).toBeNull();
  });

  it("returns null when YAML has wrong shape (no `rules` array)", async () => {
    fsMock.readFileSync.mockReturnValueOnce("foo: bar");

    const strat = new RulesStrategy("/tmp/rules.yaml");
    const result = await strat.resolve({ question: "anything", options: null });
    expect(result).toBeNull();
  });

  it("skips entries with invalid regex and continues", async () => {
    fsMock.readFileSync.mockReturnValueOnce(
      [
        "rules:",
        "  - matchPattern: '['",
        "    answer: 'broken'",
        "  - matchPattern: 'works'",
        "    answer: 'good'",
      ].join("\n"),
    );

    const strat = new RulesStrategy("/tmp/rules.yaml");
    const result = await strat.resolve({ question: "this works fine", options: null });
    expect(result?.decision).toBe("good");
  });

  it("caches the rules file across calls (single read)", async () => {
    fsMock.readFileSync.mockReturnValueOnce(
      ["rules:", "  - match: 'foo'", "    answer: 'bar'"].join("\n"),
    );

    const strat = new RulesStrategy("/tmp/rules.yaml");
    await strat.resolve({ question: "foo", options: null });
    await strat.resolve({ question: "foo again", options: null });

    expect(fsMock.readFileSync).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// LlmStrategy
// ---------------------------------------------------------------------------

function buildDecisionResponse(payload: {
  decision: string;
  reasoning: string;
  confidence: number;
}): { content: { type: "text"; text: string }[] } {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

describe("LlmStrategy", () => {
  const baseInput: DecisionInput = {
    question: "Should we use Redis or Postgres LISTEN/NOTIFY for the queue?",
    options: ["Redis", "Postgres LISTEN/NOTIFY"],
  };

  it("returns null when no API key is configured (and none in input)", async () => {
    const strat = new LlmStrategy();
    const result = await strat.resolve(baseInput);
    expect(result).toBeNull();
    expect(sdkMock.messagesCreate).not.toHaveBeenCalled();
  });

  it("calls the Anthropic SDK with the correct model and system prompt", async () => {
    sdkMock.messagesCreate.mockResolvedValueOnce(
      buildDecisionResponse({
        decision: "Postgres LISTEN/NOTIFY",
        reasoning: "Already in stack",
        confidence: 0.9,
      }),
    );

    const strat = new LlmStrategy({ anthropicApiKey: "k" });
    const result = await strat.resolve(baseInput);

    expect(result).not.toBeNull();
    expect(result?.strategy).toBe("llm");
    expect(result?.decision).toBe("Postgres LISTEN/NOTIFY");
    expect(result?.confidence).toBeCloseTo(0.9, 5);
    expect(result?.requiresHumanReview).toBe(false);

    expect(sdkMock.messagesCreate).toHaveBeenCalledTimes(1);
    const [args] = sdkMock.messagesCreate.mock.calls[0] ?? [];
    const payload = args as {
      model: string;
      system: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(payload.model).toBe("claude-sonnet-4-5");
    expect(payload.system).toContain("technical architect");
    expect(payload.system).toContain("Respond ONLY with valid JSON");
    expect(payload.messages[0]?.content).toContain("Should we use Redis");
  });

  it("flags requiresHumanReview when confidence < 0.7", async () => {
    sdkMock.messagesCreate.mockResolvedValueOnce(
      buildDecisionResponse({
        decision: "Pick Postgres",
        reasoning: "low confidence",
        confidence: 0.5,
      }),
    );

    const strat = new LlmStrategy({ anthropicApiKey: "k" });
    const result = await strat.resolve(baseInput);
    expect(result?.requiresHumanReview).toBe(true);
    expect(result?.confidence).toBeCloseTo(0.5, 5);
  });

  it("returns null on AbortError (timeout)", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    sdkMock.messagesCreate.mockRejectedValue(abortErr);

    const strat = new LlmStrategy({ anthropicApiKey: "k" });
    const result = await strat.resolve(baseInput);
    expect(result).toBeNull();
  });

  it("returns null when LLM returns malformed JSON", async () => {
    sdkMock.messagesCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "totally not json {[" }],
    });

    const strat = new LlmStrategy({ anthropicApiKey: "k" });
    const result = await strat.resolve(baseInput);
    expect(result).toBeNull();
  });

  it("returns null when the Anthropic SDK throws (after fallback also fails)", async () => {
    sdkMock.messagesCreate.mockRejectedValue(new Error("network fail"));
    const strat = new LlmStrategy({ anthropicApiKey: "k" });
    const result = await strat.resolve(baseInput);
    expect(result).toBeNull();
  });

  it("accepts a per-call API key from DecisionInput", async () => {
    sdkMock.messagesCreate.mockResolvedValueOnce(
      buildDecisionResponse({
        decision: "Use Postgres",
        reasoning: "stack alignment",
        confidence: 0.95,
      }),
    );

    const strat = new LlmStrategy(); // no constructor key
    const result = await strat.resolve({ ...baseInput, anthropicApiKey: "per-call" });
    expect(result?.decision).toBe("Use Postgres");
    expect(sdkMock.messagesCreate).toHaveBeenCalledTimes(1);
  });
});

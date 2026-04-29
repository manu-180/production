import { describe, expect, it, vi } from "vitest";
import {
  DecisionEngine,
  type DecisionInput,
  type DecisionResult,
  type DecisionStrategy,
} from "../decision-engine.js";

function makeStrategy(name: string, result: DecisionResult | null): DecisionStrategy {
  return {
    name,
    resolve: vi.fn(async (_input: DecisionInput) => result),
  };
}

function makeThrowingStrategy(name: string, err: Error): DecisionStrategy {
  return {
    name,
    resolve: vi.fn(async () => {
      throw err;
    }),
  };
}

const baseInput: DecisionInput = {
  question: "Should we use Redis or Postgres?",
  options: ["Redis", "Postgres"],
};

describe("DecisionEngine — cascade behaviour", () => {
  it("returns the first strategy's result when it matches", async () => {
    const ruleResult: DecisionResult = {
      decision: "Use Postgres",
      reasoning: "matched user rule",
      confidence: 1,
      strategy: "rule",
      requiresHumanReview: false,
    };
    const rules = makeStrategy("rules", ruleResult);
    const defaults = makeStrategy("defaults", null);
    const llm = makeStrategy("llm", null);

    const engine = new DecisionEngine({ strategies: [rules, defaults, llm] });
    const result = await engine.resolve(baseInput);

    expect(result.strategy).toBe("rule");
    expect(result.decision).toBe("Use Postgres");
    expect(rules.resolve).toHaveBeenCalledTimes(1);
    expect(defaults.resolve).not.toHaveBeenCalled();
    expect(llm.resolve).not.toHaveBeenCalled();
  });

  it("falls through to defaults when rules return null", async () => {
    const defaultsResult: DecisionResult = {
      decision: "Postgres via Supabase",
      reasoning: "Per project stack",
      confidence: 0.95,
      strategy: "default",
      requiresHumanReview: false,
    };
    const rules = makeStrategy("rules", null);
    const defaults = makeStrategy("defaults", defaultsResult);
    const llm = makeStrategy("llm", null);

    const engine = new DecisionEngine({ strategies: [rules, defaults, llm] });
    const result = await engine.resolve(baseInput);

    expect(result.strategy).toBe("default");
    expect(rules.resolve).toHaveBeenCalledTimes(1);
    expect(defaults.resolve).toHaveBeenCalledTimes(1);
    expect(llm.resolve).not.toHaveBeenCalled();
  });

  it("falls through to LLM when neither rules nor defaults match", async () => {
    const llmResult: DecisionResult = {
      decision: "Pick Postgres",
      reasoning: "alignment with stack",
      confidence: 0.9,
      strategy: "llm",
      requiresHumanReview: false,
    };
    const rules = makeStrategy("rules", null);
    const defaults = makeStrategy("defaults", null);
    const llm = makeStrategy("llm", llmResult);

    const engine = new DecisionEngine({ strategies: [rules, defaults, llm] });
    const result = await engine.resolve(baseInput);

    expect(result.strategy).toBe("llm");
    expect(rules.resolve).toHaveBeenCalledTimes(1);
    expect(defaults.resolve).toHaveBeenCalledTimes(1);
    expect(llm.resolve).toHaveBeenCalledTimes(1);
  });

  it("returns the safe fallback when every strategy declines", async () => {
    const rules = makeStrategy("rules", null);
    const defaults = makeStrategy("defaults", null);
    const llm = makeStrategy("llm", null);

    const engine = new DecisionEngine({ strategies: [rules, defaults, llm] });
    const result = await engine.resolve(baseInput);

    expect(result.confidence).toBe(0);
    expect(result.requiresHumanReview).toBe(true);
    expect(result.decision).toMatch(/Please decide/i);
  });

  it("skips strategies that throw and continues the cascade", async () => {
    const goodResult: DecisionResult = {
      decision: "fine",
      reasoning: "ok",
      confidence: 0.9,
      strategy: "default",
      requiresHumanReview: false,
    };
    const broken = makeThrowingStrategy("broken", new Error("kaboom"));
    const ok = makeStrategy("ok", goodResult);

    const engine = new DecisionEngine({ strategies: [broken, ok] });
    const result = await engine.resolve(baseInput);

    expect(result.decision).toBe("fine");
    expect(broken.resolve).toHaveBeenCalledTimes(1);
    expect(ok.resolve).toHaveBeenCalledTimes(1);
  });
});

describe("DecisionEngine — requiresHumanReview normalization", () => {
  it("forces requiresHumanReview=true when confidence < 0.7", async () => {
    const lowConfidence: DecisionResult = {
      decision: "maybe",
      reasoning: "uncertain",
      confidence: 0.5,
      strategy: "llm",
      requiresHumanReview: false, // strategy mistakenly said false
    };
    const stub = makeStrategy("llm", lowConfidence);
    const engine = new DecisionEngine({ strategies: [stub] });
    const result = await engine.resolve(baseInput);

    expect(result.requiresHumanReview).toBe(true);
    expect(result.confidence).toBe(0.5);
  });

  it("keeps requiresHumanReview=false when confidence >= 0.7", async () => {
    const highConfidence: DecisionResult = {
      decision: "Postgres",
      reasoning: "good",
      confidence: 0.85,
      strategy: "default",
      requiresHumanReview: false,
    };
    const stub = makeStrategy("defaults", highConfidence);
    const engine = new DecisionEngine({ strategies: [stub] });
    const result = await engine.resolve(baseInput);

    expect(result.requiresHumanReview).toBe(false);
  });

  it("keeps requiresHumanReview=true when the strategy already set it true (confidence >= 0.7)", async () => {
    const flagged: DecisionResult = {
      decision: "Postgres",
      reasoning: "good but flagged",
      confidence: 0.9,
      strategy: "default",
      requiresHumanReview: true,
    };
    const stub = makeStrategy("defaults", flagged);
    const engine = new DecisionEngine({ strategies: [stub] });
    const result = await engine.resolve(baseInput);

    expect(result.requiresHumanReview).toBe(true);
  });

  it("triggers human review at the boundary (confidence === 0.69)", async () => {
    const stub = makeStrategy("llm", {
      decision: "x",
      reasoning: "y",
      confidence: 0.69,
      strategy: "llm",
      requiresHumanReview: false,
    });
    const engine = new DecisionEngine({ strategies: [stub] });
    const result = await engine.resolve(baseInput);
    expect(result.requiresHumanReview).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { PRICING_USD_PER_MTOK, calcCost, resolvePricing } from "../cost-calculator.js";

describe("calcCost", () => {
  it("returns 0 for zero tokens", () => {
    expect(calcCost("claude-sonnet-4-7", { input_tokens: 0, output_tokens: 0 })).toBe(0);
  });

  it("computes basic sonnet usage", () => {
    const cost = calcCost("claude-sonnet-4-7", {
      input_tokens: 1000,
      output_tokens: 500,
    });
    expect(cost).toBeCloseTo((1000 * 3) / 1e6 + (500 * 15) / 1e6, 10);
  });

  it("computes opus with cache tokens", () => {
    const cost = calcCost("claude-opus-4-7", {
      input_tokens: 1000,
      output_tokens: 1000,
      cache_read_input_tokens: 2000,
      cache_creation_input_tokens: 500,
    });
    const expected =
      (1000 * 15) / 1e6 + (1000 * 75) / 1e6 + (2000 * 1.5) / 1e6 + (500 * 18.75) / 1e6;
    expect(cost).toBeCloseTo(expected, 10);
  });

  it("falls back to sonnet pricing for unknown model", () => {
    const sonnetCost = calcCost("claude-sonnet-4-7", {
      input_tokens: 1_000_000,
      output_tokens: 0,
    });
    const unknownCost = calcCost("totally-fake-model-xyz", {
      input_tokens: 1_000_000,
      output_tokens: 0,
    });
    expect(unknownCost).toBeCloseTo(sonnetCost, 10);
  });

  it("1M input tokens of sonnet equals $3.00", () => {
    const cost = calcCost("claude-sonnet-4-7", {
      input_tokens: 1_000_000,
      output_tokens: 0,
    });
    expect(cost).toBeCloseTo(3.0, 6);
  });

  it("substring match for opus variants", () => {
    expect(resolvePricing("claude-opus-something")).toEqual(
      PRICING_USD_PER_MTOK["claude-opus-4-7"],
    );
  });
});

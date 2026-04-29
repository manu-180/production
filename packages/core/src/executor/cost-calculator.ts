import type { TokenUsage } from "./event-types.js";

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const PRICING_USD_PER_MTOK: Readonly<Record<string, ModelPricing>> = {
  "claude-sonnet-4-7": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-opus-4-7": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-haiku-4-7": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

const SONNET_FALLBACK: ModelPricing = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
const OPUS_PRICING: ModelPricing = { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 };
const HAIKU_PRICING: ModelPricing = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 };

export function resolvePricing(model: string): ModelPricing {
  const direct = PRICING_USD_PER_MTOK[model];
  if (direct) return direct;
  const lower = model.toLowerCase();
  for (const key of Object.keys(PRICING_USD_PER_MTOK)) {
    if (lower.includes(key.toLowerCase())) {
      const found = PRICING_USD_PER_MTOK[key];
      if (found) return found;
    }
  }
  if (lower.includes("opus")) return OPUS_PRICING;
  if (lower.includes("haiku")) return HAIKU_PRICING;
  return SONNET_FALLBACK;
}

export function calcCost(model: string, usage: TokenUsage): number {
  const pricing = resolvePricing(model);
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;

  const cost =
    (input * pricing.input) / 1_000_000 +
    (output * pricing.output) / 1_000_000 +
    (cacheRead * pricing.cacheRead) / 1_000_000 +
    (cacheWrite * pricing.cacheWrite) / 1_000_000;

  return Math.max(0, cost);
}

export function aggregateUsage(events: ReadonlyArray<{ usage?: TokenUsage }>): TokenUsage {
  const total: TokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  for (const e of events) {
    if (!e.usage) continue;
    total.input_tokens += e.usage.input_tokens ?? 0;
    total.output_tokens += e.usage.output_tokens ?? 0;
    total.cache_creation_input_tokens =
      (total.cache_creation_input_tokens ?? 0) + (e.usage.cache_creation_input_tokens ?? 0);
    total.cache_read_input_tokens =
      (total.cache_read_input_tokens ?? 0) + (e.usage.cache_read_input_tokens ?? 0);
  }
  return total;
}

import { describe, expect, it } from "vitest";

import { getOpenApiSpec } from "../spec";

describe("getOpenApiSpec", () => {
  it("returns a valid OpenAPI 3.1 envelope", () => {
    const spec = getOpenApiSpec();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toMatch(/conductor/i);
    expect(typeof spec.info.version).toBe("string");
    expect(Array.isArray(spec.servers)).toBe(true);
    expect(spec.servers.length).toBeGreaterThan(0);
  });

  it("documents every Phase-10 endpoint family", () => {
    const spec = getOpenApiSpec();
    const paths = Object.keys(spec.paths);

    for (const required of [
      "/api/system/health",
      "/api/settings",
      "/api/plans",
      "/api/plans/{id}",
      "/api/plans/{id}/prompts",
      "/api/runs",
      "/api/runs/{id}",
      "/api/runs/{id}/cancel",
      "/api/runs/{id}/pause",
      "/api/runs/{id}/resume",
      "/api/runs/{id}/stream",
      "/api/runs/{id}/logs",
      "/api/runs/{id}/decisions",
      "/api/runs/{id}/decisions/{decisionId}/override",
      "/api/runs/{id}/diff/{promptId}",
    ]) {
      expect(paths, `missing path ${required}`).toContain(required);
    }
  });

  it("exposes the canonical request schemas in components", () => {
    const spec = getOpenApiSpec();
    const schemas = Object.keys(spec.components.schemas);
    for (const required of [
      "ApiError",
      "Plan",
      "PlanCreate",
      "PlanUpdate",
      "Prompt",
      "PromptInput",
      "Run",
      "RunTrigger",
      "DecisionOverride",
      "GuardianDecision",
      "DiffResponse",
      "Settings",
      "SettingsUpdate",
      "HealthResponse",
    ]) {
      expect(schemas, `missing schema ${required}`).toContain(required);
    }
  });

  it("returns a fresh object on each call (no shared mutable state)", () => {
    const a = getOpenApiSpec();
    const b = getOpenApiSpec();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks for QuestionDetector + DecisionEngine.
//
// GuardianRunner constructs both internally, so we replace the exported
// classes with controllable doubles.
// ---------------------------------------------------------------------------

const detectorMock = vi.hoisted(() => {
  const detect = vi.fn();
  const Ctor = vi.fn().mockImplementation(() => ({ detect }));
  return { detect, Ctor };
});

vi.mock("../question-detector.js", () => ({
  QuestionDetector: detectorMock.Ctor,
}));

const engineMock = vi.hoisted(() => {
  const resolve = vi.fn();
  const Ctor = vi.fn().mockImplementation(() => ({ resolve }));
  return { resolve, Ctor };
});

vi.mock("../decision-engine.js", () => ({
  DecisionEngine: engineMock.Ctor,
}));

import type { DecisionResult } from "../decision-engine.js";
import { type GuardianCheckParams, GuardianRunner } from "../guardian-runner.js";
import type { DetectionResult } from "../question-detector.js";

function makeDetectionResult(over: Partial<DetectionResult> = {}): DetectionResult {
  return {
    isQuestion: true,
    confidence: 0.9,
    extractedQuestion: "Should I proceed?",
    options: null,
    detectionMethod: "heuristic",
    heuristicScore: 0.8,
    ...over,
  };
}

function makeDecisionResult(over: Partial<DecisionResult> = {}): DecisionResult {
  return {
    decision: "Yes — proceed",
    reasoning: "Per project stack",
    confidence: 0.95,
    strategy: "default",
    requiresHumanReview: false,
    ...over,
  };
}

function baseParams(over: Partial<GuardianCheckParams> = {}): GuardianCheckParams {
  return {
    lastAssistantMessage: "Should I proceed?",
    currentInterventionCount: 0,
    ...over,
  };
}

beforeEach(() => {
  detectorMock.detect.mockReset();
  detectorMock.Ctor.mockClear();
  engineMock.resolve.mockReset();
  engineMock.Ctor.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------

describe("GuardianRunner — disabled mode", () => {
  it("never intervenes when mode is 'disabled'", async () => {
    const runner = new GuardianRunner({ mode: "disabled" });
    const result = await runner.checkAndDecide(baseParams());

    expect(result.intervened).toBe(false);
    expect(result.interventionCount).toBe(0);
    expect(result.mode).toBe("disabled");
    expect(detectorMock.detect).not.toHaveBeenCalled();
    expect(engineMock.resolve).not.toHaveBeenCalled();
  });
});

describe("GuardianRunner — intervention limit", () => {
  it("returns loopLimitReached:true when current count >= max", async () => {
    const runner = new GuardianRunner({ maxGuardianInterventions: 3 });
    const result = await runner.checkAndDecide(baseParams({ currentInterventionCount: 3 }));

    expect(result.intervened).toBe(false);
    expect(result.loopLimitReached).toBe(true);
    expect(result.interventionCount).toBe(3);
    expect(detectorMock.detect).not.toHaveBeenCalled();
  });

  it("uses the default ceiling (5) when not configured", async () => {
    const runner = new GuardianRunner();
    expect(runner.getMaxInterventions()).toBe(5);

    const result = await runner.checkAndDecide(baseParams({ currentInterventionCount: 5 }));
    expect(result.loopLimitReached).toBe(true);
  });
});

describe("GuardianRunner — non-question paths", () => {
  it("does not intervene when detector returns isQuestion:false", async () => {
    detectorMock.detect.mockResolvedValueOnce(makeDetectionResult({ isQuestion: false }));

    const runner = new GuardianRunner();
    const result = await runner.checkAndDecide(baseParams());

    expect(result.intervened).toBe(false);
    expect(result.detectionResult?.isQuestion).toBe(false);
    expect(result.interventionCount).toBe(0);
    expect(engineMock.resolve).not.toHaveBeenCalled();
  });

  it("does not intervene when detector throws", async () => {
    detectorMock.detect.mockRejectedValueOnce(new Error("detector boom"));

    const runner = new GuardianRunner();
    const result = await runner.checkAndDecide(baseParams());

    expect(result.intervened).toBe(false);
    expect(engineMock.resolve).not.toHaveBeenCalled();
  });

  it("does not intervene when decision engine throws", async () => {
    detectorMock.detect.mockResolvedValueOnce(makeDetectionResult());
    engineMock.resolve.mockRejectedValueOnce(new Error("engine boom"));

    const runner = new GuardianRunner();
    const result = await runner.checkAndDecide(baseParams());

    expect(result.intervened).toBe(false);
    expect(result.detectionResult?.isQuestion).toBe(true);
  });
});

describe("GuardianRunner — successful intervention", () => {
  it("returns a fully populated intervention result", async () => {
    detectorMock.detect.mockResolvedValueOnce(makeDetectionResult());
    engineMock.resolve.mockResolvedValueOnce(makeDecisionResult());

    const runner = new GuardianRunner();
    const result = await runner.checkAndDecide(baseParams({ currentInterventionCount: 1 }));

    expect(result.intervened).toBe(true);
    expect(result.decision?.decision).toBe("Yes — proceed");
    expect(result.detectionResult?.isQuestion).toBe(true);
    expect(result.interventionCount).toBe(2);
    expect(result.mode).toBe("auto");
  });

  it("guardianResponse starts with `[Guardian auto-decision]`", async () => {
    detectorMock.detect.mockResolvedValueOnce(makeDetectionResult());
    engineMock.resolve.mockResolvedValueOnce(makeDecisionResult());

    const runner = new GuardianRunner();
    const result = await runner.checkAndDecide(baseParams());

    expect(result.guardianResponse).toBeDefined();
    expect(result.guardianResponse?.startsWith("[Guardian auto-decision]")).toBe(true);
    expect(result.guardianResponse).toContain("Yes — proceed");
    expect(result.guardianResponse).toContain("Reasoning:");
  });

  it("increments interventionCount by exactly 1", async () => {
    detectorMock.detect.mockResolvedValue(makeDetectionResult());
    engineMock.resolve.mockResolvedValue(makeDecisionResult());

    const runner = new GuardianRunner();

    const r1 = await runner.checkAndDecide(baseParams({ currentInterventionCount: 0 }));
    expect(r1.interventionCount).toBe(1);

    const r2 = await runner.checkAndDecide(baseParams({ currentInterventionCount: 4 }));
    expect(r2.interventionCount).toBe(5);
  });

  it("falls back to lastAssistantMessage when extractedQuestion is null", async () => {
    detectorMock.detect.mockResolvedValueOnce(makeDetectionResult({ extractedQuestion: null }));
    engineMock.resolve.mockResolvedValueOnce(makeDecisionResult());

    const runner = new GuardianRunner();
    const params = baseParams({ lastAssistantMessage: "raw fallback question text" });
    await runner.checkAndDecide(params);

    expect(engineMock.resolve).toHaveBeenCalledTimes(1);
    const [arg] = engineMock.resolve.mock.calls[0] ?? [];
    const decisionInput = arg as { question: string };
    expect(decisionInput.question).toBe("raw fallback question text");
  });

  it("forwards options + recentMessages + promptContext to the decision engine", async () => {
    detectorMock.detect.mockResolvedValueOnce(makeDetectionResult({ options: ["A", "B"] }));
    engineMock.resolve.mockResolvedValueOnce(makeDecisionResult());

    const runner = new GuardianRunner();
    await runner.checkAndDecide(
      baseParams({
        promptContext: "context summary",
        recentMessages: ["msg1", "msg2"],
      }),
    );

    const [arg] = engineMock.resolve.mock.calls[0] ?? [];
    const decisionInput = arg as {
      options: string[] | null;
      promptSummary?: string;
      recentAssistantMessages?: string[];
    };
    expect(decisionInput.options).toEqual(["A", "B"]);
    expect(decisionInput.promptSummary).toBe("context summary");
    expect(decisionInput.recentAssistantMessages).toEqual(["msg1", "msg2"]);
  });

  it("forwards stopReason and hasToolUse to the detector", async () => {
    detectorMock.detect.mockResolvedValueOnce(makeDetectionResult({ isQuestion: false }));

    const runner = new GuardianRunner();
    await runner.checkAndDecide(baseParams({ stopReason: "end_turn", hasToolUse: false }));

    const [arg] = detectorMock.detect.mock.calls[0] ?? [];
    const detectionInput = arg as {
      stopReason?: string;
      hasToolUseInLastMessage?: boolean;
    };
    expect(detectionInput.stopReason).toBe("end_turn");
    expect(detectionInput.hasToolUseInLastMessage).toBe(false);
  });
});

describe("GuardianRunner — getters", () => {
  it("exposes the configured mode", () => {
    const runner = new GuardianRunner({ mode: "confirm" });
    expect(runner.getMode()).toBe("confirm");
  });

  it("exposes the SystemPromptInjector", () => {
    const runner = new GuardianRunner();
    const injector = runner.getInjector();
    expect(injector).toBeDefined();
    expect(typeof injector.inject).toBe("function");
  });
});

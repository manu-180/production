import { describe, expect, it } from "vitest";
import {
  executionStatusInfo,
  type ExecutionStatus,
  runStatusInfo,
  type RunStatus,
} from "../status";

describe("runStatusInfo", () => {
  const cases: Array<[RunStatus, { tone: string; pulse: boolean }]> = [
    ["queued", { tone: "neutral", pulse: false }],
    ["running", { tone: "info", pulse: true }],
    ["paused", { tone: "warning", pulse: false }],
    ["completed", { tone: "success", pulse: false }],
    ["failed", { tone: "danger", pulse: false }],
    ["cancelled", { tone: "danger", pulse: false }],
  ];
  it.each(cases)("maps %s correctly", (status, expected) => {
    const info = runStatusInfo(status);
    expect(info.tone).toBe(expected.tone);
    expect(info.pulse).toBe(expected.pulse);
    expect(info.label.length).toBeGreaterThan(0);
  });
});

describe("executionStatusInfo", () => {
  const cases: Array<[ExecutionStatus, { tone: string; pulse: boolean }]> = [
    ["pending", { tone: "neutral", pulse: false }],
    ["running", { tone: "info", pulse: true }],
    ["succeeded", { tone: "success", pulse: false }],
    ["failed", { tone: "danger", pulse: false }],
    ["skipped", { tone: "neutral", pulse: false }],
    ["rolled_back", { tone: "warning", pulse: false }],
    ["awaiting_approval", { tone: "warning", pulse: true }],
  ];
  it.each(cases)("maps %s correctly", (status, expected) => {
    const info = executionStatusInfo(status);
    expect(info.tone).toBe(expected.tone);
    expect(info.pulse).toBe(expected.pulse);
    expect(info.label.length).toBeGreaterThan(0);
  });
});

/**
 * Unit tests for Conductor commit-message-formatter.
 *
 * Tests cover:
 * - formatCheckpointMessage round-trip (format then parse, values match)
 * - Edge cases: no tools (shows "(none)"), cost 6-decimal formatting
 * - parseCheckpointMessage with non-Conductor message returns null
 * - parseCheckpointMessage with valid message returns correct object
 * - formatNoChangesMessage output shape
 */

import { describe, expect, it } from "vitest";
import {
  type PromptCheckpointInfo,
  formatCheckpointMessage,
  formatNoChangesMessage,
  parseCheckpointMessage,
} from "../commit-message-formatter.js";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const BASE_INFO: PromptCheckpointInfo = {
  runId: "abc12345",
  promptOrder: 2,
  totalPrompts: 5,
  promptTitle: "Implement auth middleware",
  promptFilename: "02-auth-middleware.md",
  executionId: "exec-9f3a7b21",
  toolsUsed: ["bash", "write_file", "read_file"],
  durationMs: 4321,
  tokensIn: 1500,
  tokensOut: 800,
  tokensCache: 300,
  costUsd: 0.012345,
  guardianDecisions: 3,
};

// ---------------------------------------------------------------------------
// formatCheckpointMessage — round-trip
// ---------------------------------------------------------------------------

describe("formatCheckpointMessage + parseCheckpointMessage (round-trip)", () => {
  it("produces a message that parses back to the original info", () => {
    const message = formatCheckpointMessage(BASE_INFO);
    const parsed = parseCheckpointMessage(message);

    expect(parsed).not.toBeNull();
    if (parsed === null) return; // narrow for TS

    expect(parsed.runId).toBe(BASE_INFO.runId);
    expect(parsed.promptOrder).toBe(BASE_INFO.promptOrder);
    expect(parsed.totalPrompts).toBe(BASE_INFO.totalPrompts);
    expect(parsed.promptTitle).toBe(BASE_INFO.promptTitle);
    expect(parsed.promptFilename).toBe(BASE_INFO.promptFilename);
    expect(parsed.executionId).toBe(BASE_INFO.executionId);
    expect(parsed.toolsUsed).toEqual(BASE_INFO.toolsUsed);
    expect(parsed.durationMs).toBe(BASE_INFO.durationMs);
    expect(parsed.tokensIn).toBe(BASE_INFO.tokensIn);
    expect(parsed.tokensOut).toBe(BASE_INFO.tokensOut);
    expect(parsed.tokensCache).toBe(BASE_INFO.tokensCache);
    expect(parsed.guardianDecisions).toBe(BASE_INFO.guardianDecisions);
  });

  it("round-trips the costUsd value (parsed as float, same to 6 decimals)", () => {
    const message = formatCheckpointMessage(BASE_INFO);
    const parsed = parseCheckpointMessage(message);
    expect(parsed).not.toBeNull();
    // The formatted value is toFixed(6), so parsing it gives back the same 6-decimal precision
    expect(parsed?.costUsd.toFixed(6)).toBe(BASE_INFO.costUsd.toFixed(6));
  });
});

// ---------------------------------------------------------------------------
// formatCheckpointMessage — subject line structure
// ---------------------------------------------------------------------------

describe("formatCheckpointMessage — subject line", () => {
  it("starts with 'conductor(run-{runId}):'", () => {
    const message = formatCheckpointMessage(BASE_INFO);
    expect(message.startsWith(`conductor(run-${BASE_INFO.runId}):`)).toBe(true);
  });

  it("includes promptOrder/totalPrompts and promptTitle in subject", () => {
    const message = formatCheckpointMessage(BASE_INFO);
    const subject = message.split("\n")[0];
    expect(subject).toContain(`${BASE_INFO.promptOrder}/${BASE_INFO.totalPrompts}`);
    expect(subject).toContain(BASE_INFO.promptTitle);
  });
});

// ---------------------------------------------------------------------------
// Edge case — no tools used
// ---------------------------------------------------------------------------

describe("formatCheckpointMessage — no tools used", () => {
  it("shows '(none)' in Tools-Used line when toolsUsed is empty", () => {
    const info: PromptCheckpointInfo = { ...BASE_INFO, toolsUsed: [] };
    const message = formatCheckpointMessage(info);
    expect(message).toContain("Tools-Used: (none)");
  });

  it("round-trips correctly when toolsUsed is empty", () => {
    const info: PromptCheckpointInfo = { ...BASE_INFO, toolsUsed: [] };
    const message = formatCheckpointMessage(info);
    const parsed = parseCheckpointMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed?.toolsUsed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Edge case — costUsd formatting
// ---------------------------------------------------------------------------

describe("formatCheckpointMessage — costUsd formatting", () => {
  it("formats costUsd with exactly 6 decimal places", () => {
    const info: PromptCheckpointInfo = { ...BASE_INFO, costUsd: 0.1 };
    const message = formatCheckpointMessage(info);
    expect(message).toContain("Cost-Usd: 0.100000");
  });

  it("formats costUsd = 0 as '0.000000'", () => {
    const info: PromptCheckpointInfo = { ...BASE_INFO, costUsd: 0 };
    const message = formatCheckpointMessage(info);
    expect(message).toContain("Cost-Usd: 0.000000");
  });

  it("formats a precise cost correctly", () => {
    const info: PromptCheckpointInfo = { ...BASE_INFO, costUsd: 1.234567 };
    const message = formatCheckpointMessage(info);
    expect(message).toContain("Cost-Usd: 1.234567");
  });
});

// ---------------------------------------------------------------------------
// parseCheckpointMessage — non-Conductor message returns null
// ---------------------------------------------------------------------------

describe("parseCheckpointMessage — non-Conductor messages", () => {
  it("returns null for a plain commit message", () => {
    expect(parseCheckpointMessage("fix: correct typo in README")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseCheckpointMessage("")).toBeNull();
  });

  it("returns null for a message that contains but doesn't start with the prefix", () => {
    expect(parseCheckpointMessage("chore: wrap conductor(run-abc): something")).toBeNull();
  });

  it("returns null for a conventional commit message", () => {
    expect(
      parseCheckpointMessage("feat(auth): add OAuth support\n\nDetailed description."),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseCheckpointMessage — valid messages
// ---------------------------------------------------------------------------

describe("parseCheckpointMessage — valid messages", () => {
  it("parses a hand-crafted valid message correctly", () => {
    const message = [
      "conductor(run-xyz99): 1/3 Setup database schema",
      "",
      "Prompt: 01-db-schema.md",
      "Execution-Id: exec-aabbcc",
      "Tools-Used: bash, write_file",
      "Duration: 1234ms",
      "Tokens: in=500, out=200, cache=100",
      "Cost-Usd: 0.005000",
      "Guardian-Decisions: 1",
      "",
      "🤖 Conductor automation",
    ].join("\n");

    const parsed = parseCheckpointMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed?.runId).toBe("xyz99");
    expect(parsed?.promptOrder).toBe(1);
    expect(parsed?.totalPrompts).toBe(3);
    expect(parsed?.promptTitle).toBe("Setup database schema");
    expect(parsed?.promptFilename).toBe("01-db-schema.md");
    expect(parsed?.executionId).toBe("exec-aabbcc");
    expect(parsed?.toolsUsed).toEqual(["bash", "write_file"]);
    expect(parsed?.durationMs).toBe(1234);
    expect(parsed?.tokensIn).toBe(500);
    expect(parsed?.tokensOut).toBe(200);
    expect(parsed?.tokensCache).toBe(100);
    expect(parsed?.costUsd).toBeCloseTo(0.005, 6);
    expect(parsed?.guardianDecisions).toBe(1);
  });

  it("parses a message with single tool correctly", () => {
    const info: PromptCheckpointInfo = { ...BASE_INFO, toolsUsed: ["bash"] };
    const parsed = parseCheckpointMessage(formatCheckpointMessage(info));
    expect(parsed?.toolsUsed).toEqual(["bash"]);
  });
});

// ---------------------------------------------------------------------------
// formatNoChangesMessage
// ---------------------------------------------------------------------------

describe("formatNoChangesMessage", () => {
  it("starts with the conductor(run-...) prefix", () => {
    const msg = formatNoChangesMessage("run42", 3, "Cleanup legacy code");
    expect(msg.startsWith("conductor(run-run42):")).toBe(true);
  });

  it("includes [no changes] tag in subject line", () => {
    const msg = formatNoChangesMessage("run42", 3, "Cleanup legacy code");
    const subject = msg.split("\n")[0];
    expect(subject).toContain("[no changes]");
  });

  it("includes the promptTitle in the subject", () => {
    const title = "Cleanup legacy code";
    const msg = formatNoChangesMessage("run42", 3, title);
    expect(msg).toContain(title);
  });

  it("includes the promptOrder in the subject", () => {
    const msg = formatNoChangesMessage("run42", 7, "Some title");
    const subject = msg.split("\n")[0];
    expect(subject).toContain("7");
  });

  it("includes 'No files were modified by this prompt.' in the body", () => {
    const msg = formatNoChangesMessage("run42", 3, "Cleanup");
    expect(msg).toContain("No files were modified by this prompt.");
  });

  it("ends with the Conductor automation footer", () => {
    const msg = formatNoChangesMessage("run42", 3, "Cleanup");
    expect(msg).toContain("🤖 Conductor automation");
    expect(msg.endsWith("🤖 Conductor automation")).toBe(true);
  });

  it("does not include Prompt:/Tokens: headers (it is a minimal message)", () => {
    const msg = formatNoChangesMessage("run42", 3, "Cleanup");
    expect(msg).not.toContain("Prompt:");
    expect(msg).not.toContain("Tokens:");
  });

  it("formats the full message exactly as expected", () => {
    const msg = formatNoChangesMessage("abc1", 1, "Init project");
    const expected = [
      "conductor(run-abc1): 1 Init project [no changes]",
      "",
      "No files were modified by this prompt.",
      "",
      "🤖 Conductor automation",
    ].join("\n");
    expect(msg).toBe(expected);
  });
});

import { describe, expect, it } from "vitest";
import { BASE_SYSTEM_PROMPT, buildClaudeArgs } from "../command-builder.js";

function getFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  return args[i + 1];
}

describe("buildClaudeArgs", () => {
  it("requires prompt", () => {
    expect(() => buildClaudeArgs({ prompt: "", workingDir: "/w" })).toThrow(/prompt/);
  });

  it("requires workingDir", () => {
    expect(() => buildClaudeArgs({ prompt: "hi", workingDir: "" })).toThrow(/workingDir/);
  });

  it("includes minimal args", () => {
    const args = buildClaudeArgs({ prompt: "hello", workingDir: "/w" });
    expect(args[0]).toBe("-p");
    // The prompt is fed via stdin (not as a positional arg) so it must NOT
    // appear in the args list. This is what protects us from cmd.exe's
    // 8191-char limit on Windows when prompts are large.
    expect(args).not.toContain("hello");
    expect(args).toContain("--output-format");
    expect(getFlag(args, "--output-format")).toBe("stream-json");
    expect(args).toContain("--include-partial-messages");
    expect(args).toContain("--verbose");
  });

  it("does not put a large prompt on the command line", () => {
    const huge = "x".repeat(20_000);
    const args = buildClaudeArgs({ prompt: huge, workingDir: "/w" });
    // Even a 20KB prompt must keep args well under cmd.exe's 8191-char limit.
    const totalLen = args.reduce((acc, a) => acc + a.length + 1, 0);
    expect(totalLen).toBeLessThan(2000);
    expect(args).not.toContain(huge);
  });

  it("always includes base system prompt", () => {
    const args = buildClaudeArgs({ prompt: "x", workingDir: "/w" });
    const sp = getFlag(args, "--append-system-prompt");
    expect(sp).toBe(BASE_SYSTEM_PROMPT);
  });

  it("appends extra system prompt to base", () => {
    const args = buildClaudeArgs({
      prompt: "x",
      workingDir: "/w",
      systemPromptAppend: "Extra rule.",
    });
    const sp = getFlag(args, "--append-system-prompt");
    expect(sp).toContain(BASE_SYSTEM_PROMPT);
    expect(sp).toContain("Extra rule.");
  });

  it("passes allowedTools as comma-separated list", () => {
    const args = buildClaudeArgs({
      prompt: "x",
      workingDir: "/w",
      allowedTools: ["Read", "Bash"],
    });
    expect(getFlag(args, "--allowedTools")).toBe("Read,Bash");
  });

  it("permissionMode=acceptEdits expands tool list", () => {
    const args = buildClaudeArgs({
      prompt: "x",
      workingDir: "/w",
      permissionMode: "acceptEdits",
    });
    const tools = getFlag(args, "--allowedTools") ?? "";
    for (const t of ["Edit", "Write", "Read", "Bash"]) {
      expect(tools).toContain(t);
    }
    expect(getFlag(args, "--permission-mode")).toBe("acceptEdits");
  });

  it("permissionMode=bypassPermissions sets dangerous flag", () => {
    const args = buildClaudeArgs({
      prompt: "x",
      workingDir: "/w",
      permissionMode: "bypassPermissions",
    });
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("includes maxTurns flag", () => {
    const args = buildClaudeArgs({ prompt: "x", workingDir: "/w", maxTurns: 5 });
    expect(getFlag(args, "--max-turns")).toBe("5");
  });

  it("includes resume session id", () => {
    const args = buildClaudeArgs({
      prompt: "x",
      workingDir: "/w",
      resumeSessionId: "sess-abc",
    });
    expect(getFlag(args, "--resume")).toBe("sess-abc");
  });

  it("includes model override", () => {
    const args = buildClaudeArgs({
      prompt: "x",
      workingDir: "/w",
      model: "claude-opus-4-7",
    });
    expect(getFlag(args, "--model")).toBe("claude-opus-4-7");
  });

  it("bare mode skips stream flags", () => {
    const args = buildClaudeArgs({
      prompt: "x",
      workingDir: "/w",
      bare: true,
    });
    expect(args).not.toContain("--output-format");
    expect(args).not.toContain("--include-partial-messages");
    expect(args).not.toContain("--verbose");
  });
});

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parsePromptFile } from "../prompt-parser.js";

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

describe("parsePromptFile", () => {
  it("parses a file with valid YAML frontmatter", () => {
    const raw = `---
title: My Prompt
allowedTools:
  - Read
  - Write
retries: 2
maxTurns: 10
permissionMode: acceptEdits
---
This is the body.
`;
    const parsed = parsePromptFile("01-thing.md", raw);
    expect(parsed.title).toBe("My Prompt");
    expect(parsed.frontmatter.allowedTools).toEqual(["Read", "Write"]);
    expect(parsed.frontmatter.retries).toBe(2);
    expect(parsed.frontmatter.maxTurns).toBe(10);
    expect(parsed.frontmatter.permissionMode).toBe("acceptEdits");
    expect(parsed.warnings).toEqual([]);
  });

  it("returns defaults for missing frontmatter fields", () => {
    const raw = `---
title: Solo
---
Body only.
`;
    const parsed = parsePromptFile("foo.md", raw);
    expect(parsed.frontmatter.continueSession).toBe(false);
    expect(parsed.frontmatter.allowedTools).toEqual(["Edit", "Write", "Read", "Bash"]);
    expect(parsed.frontmatter.permissionMode).toBe("default");
    expect(parsed.frontmatter.maxTurns).toBe(50);
    expect(parsed.frontmatter.timeoutMs).toBe(600_000);
    expect(parsed.frontmatter.retries).toBe(0);
    expect(parsed.frontmatter.requiresApproval).toBe(false);
    expect(parsed.frontmatter.rollbackOnFail).toBe(false);
    expect(parsed.frontmatter.tags).toEqual([]);
    expect(parsed.frontmatter.dependsOn).toEqual([]);
  });

  it("derives title from filename when title not set", () => {
    const parsed = parsePromptFile("01-setup-db.md", "Body");
    expect(parsed.title).toBe("Setup Db");
  });

  it("derives title from underscored filename", () => {
    const parsed = parsePromptFile("10_run_migration.md", "Body");
    expect(parsed.title).toBe("Run Migration");
  });

  it("derives title from filename without numeric prefix", () => {
    const parsed = parsePromptFile("intro.md", "Body");
    expect(parsed.title).toBe("Intro");
  });

  it("contentHash is sha256 of body only (frontmatter doesn't change hash)", () => {
    const body = "\nThis is the body content.\n";
    const a = parsePromptFile("a.md", `---\ntitle: A\nretries: 1\n---${body}`);
    const b = parsePromptFile("a.md", `---\ntitle: B different title\nretries: 5\n---${body}`);
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).toBe(sha256(a.content));
  });

  it("adds warning for unknown frontmatter key", () => {
    const raw = `---
title: Test
mysteryKey: value
---
Body
`;
    const parsed = parsePromptFile("x.md", raw);
    expect(parsed.warnings.some((w) => w.includes("mysteryKey"))).toBe(true);
  });

  it("does NOT throw on malformed YAML", () => {
    // YAML that gray-matter cannot parse — bad indentation in a flow-style map.
    const raw = `---
title: ok
allowedTools:
  - one
 - bad-indent
foo: [unterminated, list
bar: "quote
---
Body
`;
    expect(() => parsePromptFile("bad.md", raw)).not.toThrow();
    const parsed = parsePromptFile("bad.md", raw);
    // Either yaml threw (warnings recorded) OR validation failed (also warnings).
    // What matters is parsing did not throw and a usable frontmatter was produced.
    expect(parsed.frontmatter.permissionMode).toBe("default");
    expect(parsed.frontmatter.allowedTools).toBeDefined();
  });

  it("rawContent equals original input", () => {
    const raw = "---\ntitle: X\n---\nBody here.\n";
    const parsed = parsePromptFile("x.md", raw);
    expect(parsed.rawContent).toBe(raw);
  });

  it("body does NOT include frontmatter block", () => {
    const raw = "---\ntitle: Hello\n---\nJust the body.\n";
    const parsed = parsePromptFile("hello.md", raw);
    expect(parsed.content).not.toContain("---");
    expect(parsed.content).not.toContain("title:");
    expect(parsed.content).toContain("Just the body.");
  });

  it("handles empty file gracefully", () => {
    const parsed = parsePromptFile("empty.md", "");
    expect(parsed.frontmatter.permissionMode).toBe("default");
    expect(parsed.content).toBe("");
  });
});

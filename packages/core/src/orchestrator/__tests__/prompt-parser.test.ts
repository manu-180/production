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
    expect(parsed.frontmatter.continueSession).toBe(true);
    expect(parsed.frontmatter.allowedTools).toEqual(["Edit", "Write", "Read", "Bash"]);
    expect(parsed.frontmatter.permissionMode).toBe("bypassPermissions");
    expect(parsed.frontmatter.maxTurns).toBe(20);
    expect(parsed.frontmatter.timeoutMs).toBe(600_000);
    expect(parsed.frontmatter.retries).toBeUndefined();
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
    expect(parsed.frontmatter.permissionMode).toBe("bypassPermissions");
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
    expect(parsed.frontmatter.permissionMode).toBe("bypassPermissions");
    expect(parsed.content).toBe("");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Wave derivation
  // ───────────────────────────────────────────────────────────────────────────

  describe("wave derivation", () => {
    it("derives wave from numeric prefix '01-foo.md' → 1", () => {
      const parsed = parsePromptFile("01-foo.md", "body");
      expect(parsed.frontmatter.wave).toBe(1);
    });

    it("derives wave from '03a-foo.md' (parallel sibling) → 3", () => {
      const parsed = parsePromptFile("03a-foo.md", "body");
      expect(parsed.frontmatter.wave).toBe(3);
    });

    it("derives same wave for '03a' and '03b' (parallel siblings)", () => {
      const a = parsePromptFile("03a-x.md", "body");
      const b = parsePromptFile("03b-y.md", "body");
      expect(a.frontmatter.wave).toBe(3);
      expect(b.frontmatter.wave).toBe(3);
    });

    it("supports underscore separator '10_foo.md' → 10", () => {
      const parsed = parsePromptFile("10_foo.md", "body");
      expect(parsed.frontmatter.wave).toBe(10);
    });

    it("returns undefined wave when filename has no numeric segment in prefix", () => {
      const parsed = parsePromptFile("intro.md", "body");
      expect(parsed.frontmatter.wave).toBeUndefined();
    });

    it("recognizes 'T1-foo.md' (Spanish 'tanda') → wave 1", () => {
      const parsed = parsePromptFile("T1-mobile-drawer.md", "body");
      expect(parsed.frontmatter.wave).toBe(1);
    });

    it("recognizes 'T1a-foo.md' as wave 1 with sibling letter", () => {
      const parsed = parsePromptFile("T1a-foo.md", "body");
      expect(parsed.frontmatter.wave).toBe(1);
    });

    it("groups 'T2-x.md' and 'T2-y.md' into the same wave (2)", () => {
      const a = parsePromptFile("T2-home-remove-section.md", "body");
      const b = parsePromptFile("T2-navbar-integrate.md", "body");
      expect(a.frontmatter.wave).toBe(2);
      expect(b.frontmatter.wave).toBe(2);
    });

    it("recognizes 'W1-foo.md' (W = wave) → wave 1", () => {
      const parsed = parsePromptFile("W1-foo.md", "body");
      expect(parsed.frontmatter.wave).toBe(1);
    });

    it("recognizes 'wave3-foo.md' (full word) → wave 3", () => {
      const parsed = parsePromptFile("wave3-foo.md", "body");
      expect(parsed.frontmatter.wave).toBe(3);
    });

    it("is case-insensitive ('t1-', 't1-', 'WAVE2-' all work)", () => {
      expect(parsePromptFile("t1-foo.md", "body").frontmatter.wave).toBe(1);
      expect(parsePromptFile("WAVE2-foo.md", "body").frontmatter.wave).toBe(2);
    });

    it("recognizes 'v2-foo.md' as wave 2 (any letter prefix is permissive)", () => {
      // Note: the regex is intentionally lax — any leading letters before
      // the digits are treated as decorative. Authors who want a literal
      // 'v2' to NOT be a wave should set `wave:` explicitly in frontmatter.
      const parsed = parsePromptFile("v2-hotfix.md", "body");
      expect(parsed.frontmatter.wave).toBe(2);
    });

    it("frontmatter wave overrides filename-derived wave", () => {
      const raw = "---\nwave: 99\n---\nbody";
      const parsed = parsePromptFile("01-foo.md", raw);
      expect(parsed.frontmatter.wave).toBe(99);
    });

    it("tolerates leading zeros ('001-foo.md' → 1)", () => {
      const parsed = parsePromptFile("001-foo.md", "body");
      expect(parsed.frontmatter.wave).toBe(1);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Sub-step convention (Tnn_<scope>__NN_<title>.md)
    // ─────────────────────────────────────────────────────────────────────────
    // These must be SEQUENTIAL, not parallel siblings, even though they
    // share the same `Tnn_` prefix — the `__NN_` suffix encodes ordering.
    it("encodes sub-step as wave when filename has __NN_ suffix", () => {
      const a = parsePromptFile("T3_billing-core__01_foundation.md", "body");
      const b = parsePromptFile("T3_billing-core__02_surface.md", "body");
      expect(a.frontmatter.wave).toBe(3001);
      expect(b.frontmatter.wave).toBe(3002);
      // Sequential, not parallel — different wave numbers.
      expect(a.frontmatter.wave).not.toBe(b.frontmatter.wave);
    });

    it("supports two-digit block number with sub-step ('T10_x__03_y.md' → 10003)", () => {
      const parsed = parsePromptFile("T10_bot-intelligence-tools__03_runner.md", "body");
      expect(parsed.frontmatter.wave).toBe(10003);
    });

    it("preserves single-prefix parallel siblings (no double-underscore)", () => {
      // T3a_ and T3b_ still share wave 3 — that convention is for explicit
      // parallel siblings and must NOT be affected by the sub-step fix.
      const a = parsePromptFile("T3a-foundation.md", "body");
      const b = parsePromptFile("T3b-surface.md", "body");
      expect(a.frontmatter.wave).toBe(3);
      expect(b.frontmatter.wave).toBe(3);
    });

    it("does not treat a single underscore as a sub-step separator", () => {
      // '10_foo.md' is wave 10, not 10000 — only `__NN_` (double underscore)
      // triggers the sub-step encoding, to preserve the existing
      // `<num>_<title>` convention.
      const parsed = parsePromptFile("10_foo_bar.md", "body");
      expect(parsed.frontmatter.wave).toBe(10);
    });

    it("frontmatter wave still overrides sub-step encoding", () => {
      const raw = "---\nwave: 42\n---\nbody";
      const parsed = parsePromptFile("T3_x__01_y.md", raw);
      expect(parsed.frontmatter.wave).toBe(42);
    });
  });
});

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ClaudeCommandOptions {
  prompt: string;
  workingDir: string;
  allowedTools?: string[];
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  maxTurns?: number;
  maxBudgetUsd?: number;
  resumeSessionId?: string;
  systemPromptAppend?: string;
  model?: string;
  bare?: boolean;
}

export const BASE_SYSTEM_PROMPT =
  "Take autonomous decisions, don't ask questions, document decisions in code.";

const ACCEPT_EDITS_TOOLS = ["Edit", "Write", "Read", "Bash"] as const;

export function buildClaudeArgs(opts: ClaudeCommandOptions): string[] {
  if (typeof opts.prompt !== "string" || opts.prompt.length === 0) {
    throw new Error("buildClaudeArgs: prompt is required");
  }
  if (typeof opts.workingDir !== "string" || opts.workingDir.length === 0) {
    throw new Error("buildClaudeArgs: workingDir is required");
  }

  const args: string[] = ["-p", opts.prompt];

  if (opts.bare !== true) {
    args.push("--output-format", "stream-json");
    args.push("--include-partial-messages");
    args.push("--verbose");
  }

  const appended = opts.systemPromptAppend
    ? `${BASE_SYSTEM_PROMPT}\n${opts.systemPromptAppend}`
    : BASE_SYSTEM_PROMPT;
  args.push("--append-system-prompt", appended);

  if (opts.permissionMode === "bypassPermissions") {
    args.push("--dangerously-skip-permissions");
  } else if (opts.permissionMode === "acceptEdits") {
    const tools =
      opts.allowedTools && opts.allowedTools.length > 0
        ? Array.from(new Set([...ACCEPT_EDITS_TOOLS, ...opts.allowedTools]))
        : [...ACCEPT_EDITS_TOOLS];
    args.push("--allowedTools", tools.join(","));
    args.push("--permission-mode", "acceptEdits");
  } else {
    if (opts.allowedTools && opts.allowedTools.length > 0) {
      args.push("--allowedTools", opts.allowedTools.join(","));
    }
    if (opts.permissionMode === "default") {
      args.push("--permission-mode", "default");
    }
  }

  if (typeof opts.maxTurns === "number" && opts.maxTurns > 0) {
    args.push("--max-turns", String(Math.floor(opts.maxTurns)));
  }

  if (typeof opts.resumeSessionId === "string" && opts.resumeSessionId.length > 0) {
    args.push("--resume", opts.resumeSessionId);
  }

  if (typeof opts.model === "string" && opts.model.length > 0) {
    args.push("--model", opts.model);
  }

  return args;
}

// Cached path to the real claude.exe on Windows
let _windowsClaudeExe: string | undefined;

// On Windows, npm ships a .cmd shim that fails with EINVAL when spawned
// with shell:false. Resolve the underlying .exe the .cmd delegates to.
function resolveWindowsClaudeExe(): string {
  if (_windowsClaudeExe !== undefined) return _windowsClaudeExe;
  const cmdPath = execFileSync("where", ["claude.cmd"], { encoding: "utf8" })
    .split(/\r?\n/)[0]
    .trim();
  const exePath = join(
    dirname(cmdPath),
    "node_modules",
    "@anthropic-ai",
    "claude-code",
    "bin",
    "claude.exe",
  );
  if (!existsSync(exePath)) {
    throw new Error(
      `claude.exe not found at ${exePath} — reinstall @anthropic-ai/claude-code globally`,
    );
  }
  _windowsClaudeExe = exePath;
  return exePath;
}

export function resolveClaudeBinary(): { command: string; useShell: boolean } {
  if (process.platform === "win32") {
    return { command: resolveWindowsClaudeExe(), useShell: false };
  }
  return { command: "claude", useShell: false };
}

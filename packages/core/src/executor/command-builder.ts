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

  // The prompt goes via stdin (see ClaudeProcess.start()), NOT as a positional
  // argument. On Windows, `shell: true` routes the command through cmd.exe,
  // which has a hard 8191-character limit on the full command line. Prompts
  // larger than ~7KB blew past that and crashed with "command line too long"
  // before any stdio was captured. `claude -p` reads from stdin when no
  // positional prompt is provided, sidestepping the cmd.exe limit entirely.
  const args: string[] = ["-p"];

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

// On Windows, npm ships a .cmd shim that cannot be spawned with shell:false
// (throws EINVAL). Using shell:true lets cmd.exe invoke the shim, which in
// turn runs `node claude.js` — the proper Node.js entry point that handles
// piped stdio correctly. The alternative of spawning claude.exe directly
// does NOT work: claude.exe is an Electron binary that ignores piped stdio.
export function resolveClaudeBinary(): { command: string; useShell: boolean } {
  if (process.platform === "win32") {
    return { command: "claude.cmd", useShell: true };
  }
  return { command: "claude", useShell: false };
}

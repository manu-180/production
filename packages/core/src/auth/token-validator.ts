import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveClaudeBinary } from "../executor/command-builder.js";
import { buildClaudeEnv } from "./env-injector.js";

const execFileAsync = promisify(execFile);

/** Returns a safe log-friendly token representation: first4...last4 */
export function maskToken(token: string): string {
  if (token.length < 8) return "****";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export interface ValidateTokenResult {
  valid: boolean;
  user?: string;
  expiresAt?: Date;
}

/**
 * Validates a Claude OAuth token by running `claude -p "ping"` with it.
 * Uses buildClaudeEnv to ensure ANTHROPIC_API_KEY is never present.
 * Times out after 15 seconds.
 *
 * Returns { valid: false } on any failure — never throws.
 */
export async function validateToken(token: string): Promise<ValidateTokenResult> {
  try {
    const env = buildClaudeEnv(token);
    await execFileAsync("claude", ["-p", "ping"], {
      env,
      timeout: 15_000,
    });
    return { valid: true };
  } catch {
    return { valid: false };
  }
}

/**
 * Pre-flight check: verifies the local Claude CLI has working credentials
 * by running `claude -p "ping"` against the current process environment.
 *
 * Unlike validateToken, this does NOT inject a token — it relies on whatever
 * credentials the CLI has stored in ~/.claude/. Use this to confirm the user
 * has authenticated the CLI before kicking off long-running orchestrations.
 *
 * Returns true on exit code 0, false on any failure. Never throws.
 */
export async function validateCliAuth(): Promise<boolean> {
  try {
    const { command } = resolveClaudeBinary();
    await execFileAsync(command, ["-p", "ping"], {
      env: { ...process.env },
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}

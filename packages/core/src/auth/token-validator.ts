import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

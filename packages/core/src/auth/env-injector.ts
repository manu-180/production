/**
 * Builds a clean environment for spawning the claude CLI.
 *
 * CRITICAL: We explicitly delete ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN
 * from the env even if present in the parent process. The claude CLI checks
 * ANTHROPIC_API_KEY first — if it finds it, it uses the API (burning credits)
 * instead of the OAuth subscription. By deleting it here we guarantee the
 * CLI falls through to CLAUDE_CODE_OAUTH_TOKEN and uses the subscription.
 */
export function buildClaudeEnv(token: string, extra?: Record<string, string>): NodeJS.ProcessEnv {
  // Spread current env, then override
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Remove these so the CLI never accidentally bills the API account
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_AUTH_TOKEN: undefined,
    // Set the subscription token
    CLAUDE_CODE_OAUTH_TOKEN: token,
    ...extra,
  };
  return env;
}

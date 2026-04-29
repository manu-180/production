# ADR-001: Subscription-Based Authentication for Claude CLI

## Status
Accepted

## Date
2026-04-29

## Context
Conductor orchestrates sequential Claude Code CLI runs by spawning `claude -p --output-format stream-json` for every prompt in a plan. Each invocation must authenticate against Anthropic's services so that Claude can execute. The team has a hard requirement that runs draw from the user's existing Claude subscription quota rather than consuming paid Anthropic Console API credits — this is both a cost decision and a product positioning decision (Conductor must work for any subscription holder without forcing them to top up an API account).

The constraint is non-trivial: Claude Code CLI supports multiple authentication mechanisms (interactive browser OAuth, API keys, long-lived OAuth tokens), but only one of them is automatable in headless mode and bound to the subscription quota rather than API billing. The Worker process that spawns `claude` runs unattended (no human at a keyboard), so any mechanism that requires interactive input is unusable. Additionally, since Conductor is a multi-user product backed by Supabase, credentials must be stored securely per-user, not in shared environment files on disk.

This decision matters because it determines (1) whether Conductor is economically viable for end users, (2) what the onboarding flow looks like, and (3) what the security posture of credential storage must be.

## Decision
Use `claude setup-token` to generate a long-lived OAuth token tied to the user's Claude subscription. Store the token in Supabase encrypted at rest using Supabase Vault (or pgcrypto as a fallback for self-hosted deployments). At run time, the Worker process reads the token from the database, decrypts it, and passes it to the spawned `claude` process via the `CLAUDE_CODE_OAUTH_TOKEN` environment variable. Tokens are scoped per user, never logged, and never written to disk in plaintext.

This means zero Anthropic Console API credits are consumed by Conductor runs — every prompt execution debits the user's subscription quota, which is the desired billing model.

## Consequences
### Positive
- Runs are billed against the user's Claude subscription, not against API credits — aligns with the product's economic model.
- Long-lived tokens enable fully unattended, headless execution from the Worker.
- Per-user credential isolation is enforced by Supabase row-level security plus encryption at rest.
- No plaintext credentials touch the filesystem of the Worker host.

### Negative
- Onboarding requires a one-time manual step: the user must run `claude setup-token` locally and paste the result into Conductor. This adds friction compared to a pure web OAuth flow.
- If the user's Claude subscription lapses or the token is revoked, all queued runs fail until the token is rotated. There is no automated recovery path.
- Adds a hard dependency on Supabase Vault (or pgcrypto), which must be provisioned and key-managed correctly.

### Neutral / Risks
- Token rotation is a manual operation; we will need a UI affordance to update it without downtime.
- If Anthropic changes the long-lived token mechanism or deprecates it, Conductor must follow. This is an upstream dependency we do not control.
- A compromised token grants full subscription access to whoever holds it — encryption at rest is necessary but not sufficient; access controls on the Worker process and audit logging are also required.

## Alternatives Considered
### Alternative 1: Anthropic Console API key
**Description:** Have users provide an `ANTHROPIC_API_KEY` from console.anthropic.com and pass it to `claude` at run time.
**Rejected because:** API keys consume paid credits from the Console billing account, not subscription quota. This violates the core economic requirement that Conductor must run against the user's existing subscription. It would also force users to maintain a separate billing relationship with Anthropic just to use Conductor.

### Alternative 2: Interactive browser OAuth flow
**Description:** Trigger the standard `claude` browser-based login each time authentication is needed and capture the resulting session.
**Rejected because:** The Worker runs headless and unattended. There is no human present to complete a browser flow at the moment a run is dequeued. This makes the mechanism fundamentally incompatible with Conductor's automation model.

### Alternative 3: Token in env file on disk
**Description:** Store the OAuth token in a `.env` file or config file on the Worker host and load it at process start.
**Rejected because:** It does not scale to multi-user deployments (one shared file cannot hold per-user tokens), it places plaintext credentials on disk where backups and process inspection can leak them, and it offers no audit trail or rotation primitive. Encrypting the token in Supabase is strictly better on every axis.

## Open Questions
- Should we support a "bring your own API key" mode as a fallback for power users who prefer Console billing, or keep the auth model strictly subscription-only? (Defer until product validation.)
- What is the alerting strategy when a token starts returning auth errors mid-run — fail the run, pause the queue, or notify the user only?

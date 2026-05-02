# Troubleshooting

This page covers common issues encountered when setting up and running Conductor. Each issue includes symptoms, the root cause, and step-by-step fixes.

If your issue is not listed here, check the [FAQ](./faq.md) or open the worker logs with `docker compose logs -f worker` for detailed error output.

---

## "claude command not found"

**Symptoms:**
- Runs fail immediately with `CLAUDE_ERROR`
- Worker logs show: `Error: spawn claude ENOENT` or similar
- The onboarding wizard's "Verify Claude CLI" check fails

**Root cause:** The Claude CLI is not installed globally, or it is not on the `PATH` visible to the worker process.

**Fix:**

```bash
# Install the Claude CLI globally
npm install -g @anthropic-ai/claude-cli

# Verify the install
claude --version

# If using Docker, the claude binary must be inside the worker container.
# Rebuild the worker image after installing:
docker compose up -d --build worker
```

For Docker deployments, the `Dockerfile.worker` installs the Claude CLI during the image build. If you see this error after a Docker deployment, the image may be stale:

```bash
docker compose build --no-cache worker
docker compose up -d worker
```

**Verify the fix:**
```bash
# Local dev
which claude && claude --version

# Docker
docker exec conductor-worker claude --version
```

---

## "Token invalid" or Authentication Errors

**Symptoms:**
- Worker logs show: `Authentication failed`, `401 Unauthorized`, or `Invalid token`
- Runs fail at the first prompt with a Claude auth error
- The onboarding wizard reports token verification failed

**Root cause:** The Claude OAuth token is expired, was revoked, or was entered incorrectly.

**Fix:**

1. Go to **Settings → Claude Token** in the Conductor dashboard.
2. Delete the existing token entry.
3. Re-authenticate the Claude CLI on the host machine:
   ```bash
   claude setup-token
   ```
4. Copy the new token from the CLI output.
5. Paste it into **Settings → Claude Token** and save.

**Check the token directly:**
```bash
# Test the CLI is authenticated
claude --help
# If authentication is invalid, this will print an auth error
```

**If the token keeps expiring:** Claude OAuth tokens from a Max subscription are long-lived (typically 1 year). If yours expires frequently, check whether your Claude account has active sessions in other places that might be invalidating tokens, or contact Anthropic support.

---

## "Working directory is not a git repository"

**Symptoms:**
- Onboarding wizard reports "working directory is not a Git repository"
- Runs fail during checkpoint creation with a Git error
- Worker logs show: `fatal: not a git repository`

**Root cause:** The target working directory has not been initialized as a Git repository. Conductor requires Git for checkpoint commits and rollback.

**Fix:**

```bash
# Navigate to your target directory
cd /path/to/your/project

# Initialize a Git repository
git init

# Create an initial commit (Git requires at least one commit before Conductor can create checkpoints)
git add -A
git commit -m "initial commit before conductor"
```

After initializing, update the working directory path in Conductor's onboarding or run settings to point to the initialized repository.

**If using Docker:** Ensure the path you enter in Conductor uses the container-internal path (e.g. `/working_dirs/myproject`), not the host path, since the directory is mounted into the container.

---

## "Run stuck in queued" — Run Never Starts

**Symptoms:**
- A run shows status `queued` for more than 30 seconds without transitioning to `running`
- No activity appears in the Run Viewer
- No worker logs appear for the queued run

**Root cause:** The worker process is not running, or it cannot connect to Supabase Realtime to receive the queue notification.

**Diagnosis:**

```bash
# Check if worker is running (local dev)
ps aux | grep "conductor-worker"

# Check Docker container status
docker compose ps

# View worker logs for startup errors
docker compose logs --tail=100 worker
```

**Fix — Local dev:**
```bash
# Start the worker
pnpm --filter @conductor/worker dev

# Or restart all dev services
pnpm dev
```

**Fix — Docker:**
```bash
# Check container health
docker compose ps

# If worker is stopped or unhealthy, restart it
docker compose restart worker

# If worker keeps crashing, check logs for root cause
docker compose logs -f worker
```

**Fix — Supabase Realtime connection:**
If the worker starts but runs still queue indefinitely, the worker may not be connected to Supabase Realtime. Check the worker logs for connection errors:

```
[WARN] realtime: connection failed — retrying in 5s
[ERROR] realtime: failed to connect to wss://your-project.supabase.co/realtime
```

Verify that `NEXT_PUBLIC_SUPABASE_URL` is correct and that your server can reach Supabase's Realtime endpoint (check firewall rules).

---

## "Worker offline" Banner

**Symptoms:**
- A yellow or red "Worker offline" banner appears at the top of the dashboard
- New runs can be created but will not start until the worker is online
- The banner shows a "last seen X minutes ago" timestamp

**Root cause:** The worker process is not sending heartbeats to Supabase. The worker heartbeats every 10 seconds; the "offline" banner appears when no heartbeat has been received for 60 seconds.

**Fix — Local dev:**
```bash
# Start the worker
pnpm --filter @conductor/worker dev

# Verify it started (you should see logs within a few seconds)
```

**Fix — Docker:**
```bash
# Restart worker container
docker compose restart worker

# Monitor until it comes back online
docker compose logs -f worker
```

The banner clears automatically within 30 seconds of the worker sending its first heartbeat.

**If the worker starts but the banner persists:** The worker may be running but failing to write heartbeats to Supabase. Check for database connection errors in the worker logs:

```
[ERROR] heartbeat: failed to update heartbeat — DB connection refused
```

Verify the `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` are correct in `.env`.

---

## "Cannot connect to database" or DB Connection Errors

**Symptoms:**
- The web app shows a blank screen or "Internal Server Error"
- Worker logs show: `Connection refused`, `ECONNREFUSED`, or `password authentication failed`
- `docker compose ps` shows `conductor-db` as unhealthy or stopped

**Root cause:** Supabase connection details are wrong, or the local database container is not running.

**Fix — Check .env values:**
```bash
# Confirm these values are set and correct
grep SUPABASE .env
```

For Supabase Cloud, log in to your project dashboard at [supabase.com](https://supabase.com) → Settings → API and re-copy the URL and keys.

**Fix — Local database container:**
```bash
# Start the database container
docker compose up -d supabase-db

# Wait for it to report healthy
docker compose ps supabase-db

# Check database logs
docker compose logs supabase-db
```

**Fix — Run migrations:**
If the database is running but the application reports schema errors, the migrations may not have been applied:

```bash
# Apply migrations using the Supabase CLI (local dev)
supabase db reset

# Or apply manually against the Docker database
docker exec -i conductor-db psql -U postgres postgres < supabase/migrations/00001_initial.sql
```

---

## "Checkpoint rollback failed"

**Symptoms:**
- Clicking "Rollback to Checkpoint" in the Run Viewer shows an error
- Worker logs show: `git reset --hard failed` or `error: Your local changes would be overwritten by merge`

**Root cause:** The working directory has uncommitted changes that Git cannot overwrite without losing data. This typically happens when Claude partially completed a prompt (creating or modifying files) but the prompt failed before a checkpoint was created.

**Fix:**

Option A — Stash the changes and retry the rollback:
```bash
cd /path/to/your/working/directory
git stash
# Return to Conductor and retry the rollback
```

Option B — Discard the changes and retry:
```bash
cd /path/to/your/working/directory
git checkout .       # Discard modified tracked files
git clean -fd        # Remove untracked files and directories
# Return to Conductor and retry the rollback
```

Option C — Commit the partial changes manually, then rollback:
```bash
cd /path/to/your/working/directory
git add -A
git commit -m "manual: partial work before rollback"
# Return to Conductor and retry the rollback
```

> **Caution:** `git clean -fd` permanently deletes untracked files. Review `git status` carefully before running it.

---

## Runs Fail with "Rate Limit Exceeded"

**Symptoms:**
- Runs fail with `RATE_LIMIT` error after multiple retries
- Worker logs show: `429 Too Many Requests` or `Retry-After: 60`

**Root cause:** Your Claude subscription's rate limits have been hit. Conductor retries automatically but the retry budget was exhausted.

**Fix:**
1. Wait for the rate limit window to reset (usually 60 seconds to a few minutes).
2. Resume the run from the Run Viewer — the failed prompt will retry.
3. Increase the retry delay in the prompt's frontmatter to give the limit more time to reset:
   ```yaml
   retry:
     max_attempts: 5
     delay_seconds: 120
   ```

If you hit rate limits frequently, consider running plans during off-peak hours or splitting large prompts into smaller chunks.

---

## Next.js Build Errors After `git pull`

**Symptoms:**
- `docker compose up -d --build` fails with TypeScript errors or missing dependencies
- `pnpm dev` shows module resolution errors

**Root cause:** New dependencies were added or breaking type changes were made in the update.

**Fix:**
```bash
# Clean install
pnpm install --frozen-lockfile

# Rebuild TypeScript
pnpm typecheck

# Clear Next.js build cache
rm -rf apps/web/.next

# Restart dev
pnpm dev
```

For Docker:
```bash
docker compose build --no-cache
docker compose up -d
```

---

## Related Documentation

- [FAQ](./faq.md) — Common questions with detailed answers
- [Debug a Failed Run](./how-to/debug-failed-run.md) — Step-by-step run failure debugging
- [Self-Hosting Guide](./how-to/self-host.md) — Production deployment troubleshooting
- [Environment Variables](./reference/env-vars.md) — Verify your `.env` configuration

# How to Debug a Failed Run

When a run fails, Conductor gives you the tools to understand what went wrong, assess the state of your working directory, and decide the best path forward. This guide walks through the complete debugging workflow.

---

## Overview

A run can fail for several reasons:

- **Timeout** — Claude did not finish within the prompt's `timeout` limit
- **Claude error** — The CLI exited with a non-zero code, or the output stream was malformed
- **Guardian block** — Guardian rejected a dangerous operation
- **Worker offline** — The worker process crashed or became unreachable
- **Network/API error** — Rate limit, connectivity issue, or Anthropic service disruption

Each error type has a different root cause and a different fix. The steps below guide you from symptom to resolution.

---

## Step 1: Check the Error Message

Navigate to **Runs** and open the failed run. The run detail page shows:

- **Run status badge** — `failed`, `cancelled`, or `error`
- **Failed at prompt** — which step in the plan caused the failure
- **Error summary** — a one-line description of the error type
- **Attempt count** — how many times the prompt was retried before giving up

The error summary is your first signal. It will read something like:

```
TIMEOUT: Prompt exceeded 300s limit on attempt 3/3
CLAUDE_ERROR: Exit code 1 — stderr: "cannot find module '@/lib/db'"
GUARDIAN_BLOCKED: Operation blocked: mass file deletion detected
WORKER_OFFLINE: No heartbeat received for 90s
```

---

## Step 2: View the Execution Logs

Click **View Logs** on the failed run or the specific failed prompt to open the log panel. The log panel shows every event Conductor recorded during execution, in order.

**What to look for:**

**Timeout errors (`TIMEOUT`)**
Look for the last assistant message before the timeout. It tells you how far Claude got. If Claude was mid-generation, the work may be partially complete in your working directory.

```
[12:01:05] executor: spawned claude child (pid=4821)
[12:01:06] executor: prompt sent to stdin (428 bytes)
[12:03:45] executor: stream active — 1847 tokens generated
[12:06:06] executor: TIMEOUT — process killed after 300s
```

**Claude CLI errors (`CLAUDE_ERROR`)**
Look for the `stderr` lines — they contain the actual error message from the Claude process. Common causes are import errors, missing dependencies, or workspace configuration issues.

```
[12:01:05] executor: spawned claude child (pid=4821)
[12:01:06] executor: prompt sent to stdin
[12:01:09] executor: stderr: "Error: Cannot find module '@/lib/db'"
[12:01:09] executor: process exited with code 1
```

**Guardian blocks (`GUARDIAN_BLOCKED`)**
Look for the `guardian.decision` event. It shows the question Claude asked and why Guardian blocked it.

```
[12:01:05] executor: spawned claude child
[12:01:45] guardian: question detected — "Delete all files in /tmp/build?"
[12:01:45] guardian: strategy=rules, decision=BLOCK, confidence=0.99
[12:01:45] guardian: operation blocked — run paused
```

**Rate limit errors**
Look for a `429` response or `Retry-After` header in the logs. Conductor's rate limit handler should have retried automatically, but if the budget was exhausted, it surfaces here.

```
[12:01:05] executor: spawned claude child
[12:01:07] recovery: rate-limit detected — Retry-After: 60s
[12:02:07] executor: retry attempt 2/3 — spawned claude child
[12:02:09] recovery: rate-limit detected — Retry-After: 120s
[12:02:09] recovery: retry budget exhausted
```

---

## Step 3: Check the Working Directory State

Before deciding how to respond to a failure, check what state your working directory is in. The Run Viewer shows the diff between the last successful checkpoint and the current working directory state.

Click **View Diff** in the run detail panel. Three scenarios:

**Scenario A — Working directory is clean**
Claude made no changes before failing. The failure happened early (likely a configuration or network issue). You can safely retry without rolling back.

**Scenario B — Working directory has partial changes**
Claude made some changes before the failure. The diff shows files modified, created, or deleted. Evaluate whether these changes are correct before retrying. If they are not, use **Rollback to Checkpoint** to restore the last clean state.

**Scenario C — Working directory matches last checkpoint**
Claude completed some work and a checkpoint was created, then a later step failed. The diff will be empty (matching the checkpoint). You can resume from the failed step — the earlier work is preserved.

---

## Step 4: Identify the Error Type and Fix

### `TIMEOUT` — Prompt Exceeded Time Limit

**Cause:** Claude did not finish within the prompt's `timeout` limit.

**Diagnosis:** Look at the log's last assistant message. If Claude was generating a large amount of code, the task may simply need more time. If Claude appeared to be looping (the same pattern repeated), the prompt may be ambiguous.

**Fixes:**

1. Increase the timeout in the prompt's frontmatter:
   ```yaml
   timeout: 900   # was 300
   ```

2. If the task is genuinely large, split it into smaller prompts.

3. If Claude appeared stuck, rewrite the prompt to be more specific about success criteria.

4. Use **Resume from Failed Prompt** to retry with the new timeout — previous successful steps are preserved.

---

### `CLAUDE_ERROR` — Claude CLI Non-Zero Exit

**Cause:** The Claude CLI process exited with a non-zero exit code, indicating an error that prevented Claude from completing the task.

**Diagnosis:** Read the `stderr` lines in the execution log. Common sub-types:

- **Import/module error** — A dependency is missing or the workspace configuration is wrong. Fix the dependency first, then retry.
- **TypeScript error** — Claude's generated code has a type error. The error message will include the file and line. You can either fix it manually and restart, or add explicit instructions to the prompt to fix TypeScript errors before finishing.
- **Permission error** — Claude attempted to write to a path it does not have access to. Check the working directory permissions.
- **Tool error** — Claude tried to run a CLI command (e.g. `pnpm install`) that failed. The command output is usually in the log.

**Verify your token:**
If you see an authentication error, your Claude token may have expired or been revoked. Go to **Settings → Claude Token** and re-enter a fresh token.

```bash
# Re-authenticate the Claude CLI
claude setup-token
```

---

### `GUARDIAN_BLOCKED` — Operation Blocked

**Cause:** Guardian's rules or LLM strategy determined that Claude's requested operation was too risky to auto-approve.

**Diagnosis:** Open the Guardian panel in the Run Viewer. The blocked decision shows:
- What operation Claude was about to perform
- Why Guardian blocked it (the reasoning)
- The strategy that produced the decision

**Fixes:**

1. **If the block was correct** — The operation was genuinely risky. Rewrite the prompt to be more explicit and constrained:
   ```markdown
   Delete ONLY the files listed below. Do not delete any other files.
   - tmp/build.log
   - tmp/cache.json
   ```

2. **If the block was a false positive** — Lower the risk level for this prompt or set `auto_approve: true` if you have verified the prompt is safe:
   ```yaml
   guardian:
     risk_level: low
   ```

3. **Resume the run** — After adjusting, use Resume from the failed prompt. Guardian will re-evaluate with the updated configuration.

---

### `WORKER_OFFLINE` — Worker Process Unreachable

**Cause:** The worker process stopped sending heartbeats. The worker heartbeats every 10 seconds; a run is marked failed if no heartbeat is received for 90 seconds.

**Diagnosis:** Check whether the worker is running.

For local dev:
```bash
ps aux | grep "conductor-worker"
# Or check the terminal where you ran `pnpm dev`
```

For Docker:
```bash
docker compose ps
# Look for conductor-worker — should show "Up" and "healthy"
docker compose logs --tail=50 worker
```

**Fixes:**

1. Restart the worker:
   ```bash
   # Local dev
   pnpm --filter @conductor/worker dev

   # Docker
   docker compose restart worker
   ```

2. After the worker is back online, use **Resume from Last Checkpoint** to continue the run from where it stopped. Conductor's crash recovery detects orphaned runs on worker startup and automatically resumes them.

---

### Rate Limit Errors

**Cause:** Anthropic's API or Claude CLI is rate-limiting requests.

**Diagnosis:** Look for `429` in the logs or `Retry-After` headers.

**Fixes:**

1. Conductor retries automatically with exponential backoff. If the run failed despite retries, the rate limit period may be longer than the retry budget. Wait a few minutes and resume.

2. Increase the retry delay in the prompt's frontmatter:
   ```yaml
   retry:
     max_attempts: 5
     delay_seconds: 60
   ```

3. Check your Claude account usage — if you are near your subscription limit, usage may be throttled.

---

## Step 5: Choose a Recovery Action

After diagnosing the failure, choose the appropriate recovery action from the Run Viewer.

### Resume from Failed Prompt

Retries the failed prompt. All previously completed prompts and their checkpoints are preserved. The run continues from exactly where it stopped.

**Use when:** The failure was transient (network issue, timeout on a slow operation, rate limit) and you have fixed the root cause or increased the timeout.

**How:** Run Viewer → **Resume** → confirm

---

### Restart from Beginning

Discards all progress and starts the run from the first prompt. Working directory is rolled back to the state before the run started.

**Use when:** Multiple prompts produced incorrect output, or the plan itself has changed significantly since the run started.

**How:** Run Viewer → overflow menu (`...`) → **Restart from Beginning** → confirm

---

### Rollback to Checkpoint, Then Resume

Rolls the working directory back to a specific checkpoint (Git commit), then resumes the run from that point.

**Use when:** Claude made incorrect changes that were checkpointed, and you want to undo those changes and retry from a known-good state.

**How:** Run Viewer → **Checkpoint Timeline** → select target checkpoint → **Rollback** → **Resume from here**

---

### Skip the Failed Prompt

If the failed prompt is not critical to the rest of the run, you can mark it as skipped and continue.

**Permanent skip** — Set `skip_on_error: true` in the prompt's frontmatter:
```yaml
skip_on_error: true
```

**One-time skip** — Run Viewer → failed prompt → overflow menu → **Skip This Prompt**

**Caution:** Subsequent prompts may depend on output from the skipped prompt. Review all remaining prompts carefully before skipping.

---

## Common Error Reference

| Error Code | Meaning | First Action |
|---|---|---|
| `TIMEOUT` | Prompt exceeded time limit | Increase `timeout` in frontmatter |
| `CLAUDE_ERROR` | Claude CLI non-zero exit | Read stderr in logs |
| `GUARDIAN_BLOCKED` | Operation blocked by Guardian | Review Guardian decision, adjust prompt |
| `WORKER_OFFLINE` | Worker stopped heartbeating | Restart worker, check Docker status |
| `RATE_LIMIT` | API rate limit hit | Wait, then resume |
| `AUTH_ERROR` | Claude token invalid/expired | Re-enter token in Settings |
| `GIT_ERROR` | Git operation failed | Check working directory git status |
| `NETWORK_ERROR` | Connectivity issue | Check network, retry |

---

## Related Documentation

- [Configure Guardian](./configure-guardian.md) — Tune Guardian to reduce false blocks
- [Writing Prompts](./write-prompts.md) — Frontmatter options including `timeout`, `retry`, and `skip_on_error`
- [Troubleshooting](../troubleshooting.md) — Common environment setup issues

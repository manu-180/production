# Frequently Asked Questions

---

### 1. Does Conductor work with models other than Claude?

No. Conductor is Claude-only by design.

The core architecture depends on the `claude` CLI subprocess and its `--output-format stream-json` mode, which is specific to Anthropic's tooling. The Guardian agent also uses Claude for LLM-backed decisions. Supporting other models would require a substantial rewrite of the Executor, the stream parser, and the Guardian's LLM fallback strategy.

The economic model of Conductor — running complex multi-step tasks at flat subscription cost rather than paying per-token — is specific to Claude Max subscriptions. Adapting Conductor to other provider APIs would require a different billing model.

Support for other models is not on the roadmap.

---

### 2. Can I run multiple runs in parallel?

No. Runs execute serially, one at a time per user.

This is intentional. Conductor executes plans against a working directory — a Git repository on your filesystem. Running two plans concurrently against the same directory would cause Git conflicts, interleaved file modifications, and race conditions in checkpoints and rollbacks.

If you have multiple codebases and want to run plans on them simultaneously, you can run separate Conductor instances, each pointing to a different working directory and using its own Supabase project.

Parallel execution within a single run (e.g. running independent prompt branches concurrently) is a potential future enhancement. The current sequential model keeps the system predictable and auditable.

---

### 3. What happens if the worker crashes mid-run?

Conductor's crash recovery automatically resumes from the last successful checkpoint.

When the worker starts up, it runs a startup recovery sweep (`startup-recovery.ts`) that looks for runs with status `running` but no recent heartbeat. These are "orphaned" runs — they were being processed by a worker that died without cleaning up.

For each orphaned run, the recovery module:

1. Checks the last successful checkpoint (Git commit SHA stored on the last `succeeded` execution)
2. Rolls the working directory back to that checkpoint with `git reset --hard <sha>`
3. Marks the in-progress execution as `failed` with reason `worker_crash`
4. Requeues the run starting from the failed prompt

The prompt that was running when the crash occurred is retried (subject to its `retry.max_attempts` setting). No successfully completed prompts need to be re-run.

If the working directory has unsaved changes that conflict with the rollback, crash recovery logs an error and marks the run as requiring manual intervention.

---

### 4. How do I back up my plans?

Plans and all run data are stored in your Supabase database. Use the included backup script for a full database export:

```bash
bash scripts/backup.sh
```

This creates a timestamped backup in `./backups/` containing:
- A full Postgres dump (plans, prompts, runs, executions, events, guardian decisions)
- Your encrypted `.env` configuration

For Supabase Cloud users, Supabase also provides automated daily backups in your project dashboard under Storage → Backups.

To export an individual plan as a portable file set, use the Plan Editor's **Export** button, which downloads the plan's prompt files as a `.zip`.

Store backups off-machine. If using a VPS, configure an automated rsync or rclone job to copy backups to S3, Backblaze B2, or similar.

---

### 5. Can I share plans between users?

Not in the current version. Conductor is designed for single-operator use — plans and runs are scoped to the authenticated user.

Multi-user support (teams, plan sharing, permission controls) is planned for a future version. The database schema has groundwork for it (user IDs on all records, RLS policies scoped per user), but the UI and access control layer are single-user only.

For now, the recommended approach for teams is to export plans as Markdown files and commit them to a shared Git repository. Each team member imports the plan files into their own Conductor instance.

---

### 6. How is my Claude token secured?

Your Claude OAuth token is encrypted at rest using AES-256-GCM before being stored in the database.

The encryption key is the `CONDUCTOR_ENCRYPTION_KEY` environment variable — a 32-byte random key you generate and control. The token is never stored in plaintext in the database, in logs, or in the browser.

The decrypted token is held in worker process memory only for the duration of a run — it is passed directly to the `claude` CLI subprocess as a subprocess environment variable, never written to disk.

If you need to rotate the token (e.g. if your Claude account credentials change), go to **Settings → Claude Token**, enter the new token, and save. The old encrypted value is replaced.

If you need to rotate the `CONDUCTOR_ENCRYPTION_KEY`, all stored tokens must be re-entered because the old ciphertext is not recoverable with a new key.

---

### 7. What is a "checkpoint"?

A checkpoint is a Git commit of the working directory state, created by Conductor after a prompt successfully completes.

When `checkpoint: true` is set in a prompt's frontmatter, Conductor runs:
```bash
git add -A
git commit -m "conductor: run=<id> prompt=<id> step=N/M"
```

The resulting commit SHA is stored in the database. The Run Viewer displays the commit timeline with diffs for each checkpoint.

Checkpoints enable rollback — from the Run Viewer, you can restore the working directory to any previous checkpoint state with a single click. This is especially useful when Claude makes a mistake several prompts into a long run: you can roll back to the last known-good state and retry rather than starting over.

Checkpoints are real Git commits in your working directory's history. After a run completes, the checkpoint commits appear in your normal `git log`.

---

### 8. How do I delete a run?

Open the run detail page at `/dashboard/runs/[id]`. Click the overflow menu (`...`) in the top-right corner and select **Delete Run**.

Deleting a run:
- Removes the run record and all associated executions, events, and Guardian decisions from the database
- Does **not** undo any changes Claude made to the working directory
- Does **not** delete Git checkpoints (commits) in the working directory — those are permanent Git history

If you want to undo the changes from a run, first use **Rollback to Checkpoint** to restore the working directory, then delete the run.

Active (running) runs cannot be deleted. Cancel the run first, then delete.

---

### 9. Can I schedule runs?

Yes. Go to **Settings → Schedules** to create scheduled runs.

Conductor supports cron syntax for scheduling:
```
# Every day at 9am
0 9 * * *

# Every Monday at midnight
0 0 * * 1

# Every 30 minutes
*/30 * * * *
```

A scheduled run creates a new run instance at the scheduled time against the plan and working directory you configure. The run executes exactly as if you had clicked "Run Plan" manually.

Scheduled runs appear in the **Runs** list with a clock icon. You can view their history, inspect logs, and manage failures from the same interface as manually triggered runs.

---

### 10. Is there a rate limit?

Claude's API rate limits apply to all requests made by the `claude` CLI.

Conductor has built-in rate limit handling in the recovery module:

- When the CLI returns a 429 response or includes a `Retry-After` header, Conductor parses the header and waits the specified duration before retrying.
- Retries use exponential backoff with jitter in addition to the `Retry-After` value.
- If the rate limit retry budget is exhausted, the execution fails with a `RATE_LIMIT` error and you can resume manually once the limit window resets.

Rate limits depend on your Claude subscription tier. Claude Max subscribers have generous rate limits suited for batch automation. If you hit limits frequently, consider:

- Adding longer `timeout` and `retry.delay_seconds` values to your prompts
- Splitting very large prompts into smaller tasks
- Running plans during off-peak hours

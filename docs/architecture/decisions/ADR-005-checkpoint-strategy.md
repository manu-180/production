# ADR-005: Git-Based Checkpoint Strategy per Prompt

## Status
Accepted

## Date
2026-04-29

## Context
Conductor runs sequences of prompts that mutate a working directory — Claude writes files, runs build commands, refactors code. When prompt N fails after retries, we need to roll back the working directory to its state after prompt N-1, not to its pre-run state and not to some other arbitrary point. Equivalently, when a user inspects a completed run, they should be able to see exactly what each prompt produced.

The working directory is a developer's repository (or becomes one): Conductor must coexist with the user's normal git workflow without polluting `main`, without losing their uncommitted work, and without making changes that are hard to undo. Whatever checkpoint mechanism we choose has to scale to large repositories (multi-GB monorepos), survive Worker process restarts, and integrate with the developer's existing tools so they can `git diff` between checkpoints natively.

This is a recovery primitive: choosing wrong here means failed runs corrupt the working tree or leave it in inconsistent intermediate states the user has to manually clean up.

## Decision
Use git itself as the checkpoint mechanism, on a dedicated per-run branch.

For each Run, create a branch named `conductor/run-{runId}` (where `runId` is a UUID) in the target working directory. Switch to that branch before the first prompt executes. After each successful Prompt execution, create a commit with the message format: `conductor(run-{runId}): checkpoint after prompt {order} - {title}`. Store the resulting commit SHA in the corresponding `PromptExecution.checkpointSha` column.

On failure after exhausting retries: `git reset --hard` to the last successful `checkpointSha`. On Run completion: leave the branch in place so the user can inspect, diff, cherry-pick, or merge it. Whether to auto-merge into the source branch is a user-controlled per-run setting and defaults to off.

If the working directory is not a git repository, Conductor runs `git init` before starting the run. If there are uncommitted changes when a run begins, Conductor stashes them under a labeled stash (`conductor: pre-run stash for {runId}`) and restores them on the source branch when the run is cleaned up.

## Consequences
### Positive
- Recovery is a single `git reset --hard` — fast, atomic, and exactly what developers expect.
- Each prompt becomes a real commit with a real diff. Users can `git log conductor/run-{id}` and see the run as a sequence of changes in their normal tools.
- Scales to arbitrarily large repositories — git already handles this efficiently.
- Zero new infrastructure: git is already on every developer machine.
- The dedicated branch keeps `main` and feature branches clean.

### Negative
- Requires git availability in the working directory (auto-initialized if missing, but this is a side effect users should know about).
- Run branches accumulate over time. A user with 200 runs has 200 `conductor/run-*` branches cluttering their branch list until pruned.
- A run that modifies the git history itself (e.g. a prompt that runs `git rebase`) can confuse the checkpoint flow. We document this and detect history rewrites before checkpointing.
- If the user has uncommitted work and the stash/restore step fails (e.g. merge conflict on restore), we surface a clear error rather than silently dropping their changes.

### Neutral / Risks
- Branch naming uses UUIDs so collisions are not a real concern, but the namespace `conductor/` should be reserved by convention.
- Pruning policy is unresolved — see Open Questions. Users will need a "clean up old run branches" affordance.
- Per-prompt commits inflate object count in the repo's `.git` directory; for very long runs this could be a real cost. `git gc` mitigates it.

## Alternatives Considered
### Alternative 1: File snapshots (tar/zip)
**Description:** After each prompt, archive the working directory tree to a tarball stored in Supabase Storage or on disk, keyed by checkpointId.
**Rejected because:** It does not scale — a 2 GB repo becomes 2 GB per checkpoint, which is wasteful when 99% of files are unchanged. It does not integrate with developer tooling (you cannot `git diff` between two tarballs). Recovery means delete-and-extract, which is slow and error-prone. Git already solves snapshotting efficiently via content-addressed objects.

### Alternative 2: Commit directly to the source branch
**Description:** Skip the dedicated branch and commit each prompt's checkpoint to whatever branch the user was on (typically `main` or a feature branch).
**Rejected because:** It pollutes git history with intermediate states the user did not author and may not want to keep. A failed run leaves half-finished commits on a branch the user thought was clean. Recovery requires an interactive rebase. The dedicated branch isolates Conductor's commits and lets the user choose whether to merge them.

### Alternative 3: Stash-based recovery
**Description:** Use `git stash` between prompts to capture state and restore on failure.
**Rejected because:** Stashes are local to a working tree and do not survive process restarts cleanly. They are not an addressable history — you cannot reset to "the stash before prompt 5". Stash semantics also lose untracked files unless explicitly opted in. Branches are the right primitive for this use case.

## Open Questions
- **Pruning strategy.** Run branches accumulate. Auto-delete after N days? After successful merge? Only on user command? Likely a combination, but the policy is undecided.
- **Behavior when the working directory's `main` branch is updated mid-run by an outside process.** Our run branch is unaffected, but a subsequent merge may conflict. Detect and warn, or attempt automatic rebase?
- **History-rewriting prompts.** What is the right behavior when a prompt itself runs `git reset` or `git rebase` on the run branch? Probably abort and surface an error, but the detection mechanism needs design.
- **Submodules and worktrees.** Behavior in repos with submodules or active worktrees is untested and likely needs explicit handling.

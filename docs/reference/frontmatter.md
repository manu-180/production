# Prompt Frontmatter Reference

Every Conductor prompt file begins with a YAML frontmatter block delimited by `---` lines. Conductor's plan loader validates this block before a run starts — invalid or missing required fields cause a validation error at plan load time, not at runtime.

For a narrative guide on using these fields with examples and best practices, see [How to Write Prompts](../how-to/write-prompts.md).

---

## Quick Reference Table

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | string | **Yes** | — | Unique identifier for the prompt within the plan. Used in `depends_on` references, commit messages, and database records. Recommended format: kebab-case. |
| `title` | string | **Yes** | — | Human-readable label shown in the Run Viewer, Plan Editor, and Insights reports. |
| `order` | integer | No | Auto (filename sort) | Explicit 1-based execution position. Overrides filename-based ordering. Gaps allowed. |
| `depends_on` | string[] | No | `[]` | List of prompt `id` values that must reach `succeeded` before this prompt starts. If a dependency fails, this prompt is marked `blocked`. |
| `working_dir` | string | No | Run-level working directory | Override the working directory for this prompt only. Relative paths resolve from the run-level root. |
| `timeout` | integer | No | `300` | Maximum seconds to wait for Claude before killing the process and marking the execution failed. Measured from process spawn to exit. |
| `retry.max_attempts` | integer | No | `1` | Total number of attempts, including the first. `1` means no retry. `3` means one initial attempt plus two retries. |
| `retry.delay_seconds` | integer | No | `10` | Base delay in seconds between retry attempts. Conductor applies exponential backoff: `base * 2^attempt_index` with jitter. |
| `guardian.auto_approve` | boolean | No | `false` | When `true`, bypasses all Guardian strategy logic for this prompt. All Claude questions are answered automatically with a generic "proceed" reply. |
| `guardian.risk_level` | enum | No | Inferred | Guardian risk hint: `low`, `medium`, or `high`. Influences auto-approval thresholds in the active strategy. See Guardian docs for per-strategy behavior. |
| `skip_on_error` | boolean | No | `false` | When `true` and the prompt fails after all retries, marks the execution `skipped` and continues the run rather than failing it. Subsequent prompts that depend on this prompt's output may produce incorrect results. |
| `checkpoint` | boolean | No | `false` | When `true`, creates a Git commit in the working directory after this prompt succeeds. The commit is structured for machine readability and is the basis of rollback. |

---

## Field Details

### `id`

```yaml
id: refactor-user-service
```

- **Type:** string
- **Required:** Yes
- **Constraints:** Must be unique within the plan. Must match `[a-z0-9-_]+` (letters, numbers, hyphens, underscores). No spaces.
- **Usage:** Referenced by `depends_on` in other prompts. Appears in checkpoint commit messages as `prompt=<id>`. Appears in Guardian decision records and run event logs.

---

### `title`

```yaml
title: "Refactor UserService to use repository pattern"
```

- **Type:** string
- **Required:** Yes
- **Constraints:** No length limit, but keep under 80 characters for readability in the UI.
- **Usage:** Displayed in the Run Viewer step list, the Plan Editor prompt list, and the Insights prompt performance leaderboard.

---

### `order`

```yaml
order: 3
```

- **Type:** positive integer (1-based)
- **Required:** No
- **Default:** Auto-assigned based on alphabetical/numeric sort of filenames (e.g. `01-setup.md` → order 1)
- **Notes:** Explicit `order` values take precedence over filename ordering. You may leave gaps between values (e.g. 10, 20, 30) to allow future inserts. Duplicate `order` values within a plan cause a validation error.

---

### `depends_on`

```yaml
depends_on:
  - scaffold-project
  - add-dependencies
```

- **Type:** array of strings (prompt IDs)
- **Required:** No
- **Default:** `[]` (no dependencies — prompt runs after all prompts with a lower `order` value)
- **Notes:** Referenced IDs must exist in the same plan. Circular dependencies are detected at plan load time and cause a validation error. If any listed dependency has status `failed`, this prompt is marked `blocked` and skipped.

---

### `working_dir`

```yaml
working_dir: ./packages/api
```

- **Type:** string (path)
- **Required:** No
- **Default:** The run-level working directory set when the run was created
- **Notes:** Relative paths are resolved from the run-level working directory root. Absolute paths are used as-is. The path must exist and be accessible inside the worker container. Each prompt in a plan can use a different working directory, enabling cross-package operations in monorepos.

---

### `timeout`

```yaml
timeout: 600
```

- **Type:** positive integer (seconds)
- **Required:** No
- **Default:** `300` (5 minutes)
- **Notes:** Measured from the moment the Claude CLI process is spawned to the moment it exits. Does not include retry delays. If exceeded, the process is killed with SIGTERM and the execution is marked `TIMEOUT`. Increase for large code generation tasks. The maximum allowed value is `3600` (1 hour).

---

### `retry.max_attempts`

```yaml
retry:
  max_attempts: 3
```

- **Type:** positive integer
- **Required:** No
- **Default:** `1` (no retry)
- **Notes:** Total attempts including the first. A value of `1` means the prompt runs once and fails immediately on error. A value of `3` means one initial attempt plus two retries. Each retry creates a new `executions` row in the database with an incremented `attempt` counter.

---

### `retry.delay_seconds`

```yaml
retry:
  delay_seconds: 15
```

- **Type:** non-negative integer (seconds)
- **Required:** No
- **Default:** `10`
- **Notes:** Base delay between attempts. Conductor applies exponential backoff with jitter: `delay = base * 2^attempt_index + random(0, base)`. For `delay_seconds: 15` with 3 attempts: first retry after ~15-30s, second retry after ~30-60s. The actual delay is also bounded by any `Retry-After` header from the Anthropic API.

---

### `guardian.auto_approve`

```yaml
guardian:
  auto_approve: true
```

- **Type:** boolean
- **Required:** No
- **Default:** `false`
- **Notes:** When `true`, the Guardian strategy pipeline is bypassed entirely. Any question Claude asks is answered with "proceed as you think best." The decision is still recorded in the audit log with `auto_approve=true`. Use with care — this prevents Guardian from blocking genuinely dangerous operations for this prompt.

---

### `guardian.risk_level`

```yaml
guardian:
  risk_level: high
```

- **Type:** enum: `low` | `medium` | `high`
- **Required:** No
- **Default:** Inferred by Guardian from question content
- **Notes:** Provides an explicit hint to Guardian's decision strategies about the expected risk of this prompt. The effect depends on the active global strategy mode:

  | risk_level | conservative | balanced | permissive |
  |---|---|---|---|
  | `low` | May auto-approve | Auto-approve | Auto-approve |
  | `medium` | Ask | Ask | May auto-approve |
  | `high` | Block/ask | Ask/human review | Ask |

---

### `skip_on_error`

```yaml
skip_on_error: true
```

- **Type:** boolean
- **Required:** No
- **Default:** `false`
- **Notes:** When `true` and all retry attempts for this prompt are exhausted, the execution is marked `skipped` and the run continues to the next prompt. The run's final status will be `completed_with_skips` rather than `failed`. Note that prompts listed in another prompt's `depends_on` that were skipped will mark those dependents as `blocked`.

---

### `checkpoint`

```yaml
checkpoint: true
```

- **Type:** boolean
- **Required:** No
- **Default:** `false`
- **Notes:** When `true` and the prompt execution succeeds, Conductor runs `git add -A && git commit` in the working directory. The commit message format is:
  ```
  conductor: run=<run_id> prompt=<prompt_id> step=<N>/<total>
  ```
  The resulting commit SHA is stored on the `executions` row. Checkpoints are used as rollback targets. If the Git working directory has no changes (nothing to commit), the checkpoint is skipped silently — no empty commit is created.

---

## Complete Example

```yaml
---
id: implement-payment-gateway
title: "Implement Stripe payment gateway integration"
order: 5
depends_on:
  - scaffold-backend
  - add-stripe-dependency
working_dir: ./packages/payments
timeout: 900
retry:
  max_attempts: 3
  delay_seconds: 20
guardian:
  auto_approve: false
  risk_level: high
skip_on_error: false
checkpoint: true
---
Implement the Stripe payment gateway integration in `src/gateway/stripe.ts`.
...
```

---

## Related Documentation

- [How to Write Prompts](../how-to/write-prompts.md) — Narrative guide with examples and best practices
- [Configure Guardian](../how-to/configure-guardian.md) — Guardian strategy configuration
- [Debug a Failed Run](../how-to/debug-failed-run.md) — Using retry, skip, and rollback

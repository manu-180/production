# How to Write Conductor Prompts

A Conductor prompt is a Markdown file that combines structured metadata (YAML frontmatter) with the natural-language instructions sent to Claude. Getting both parts right is the difference between a run that completes cleanly and one that gets stuck, times out, or produces unpredictable output.

This guide covers the anatomy of a prompt file, the complete frontmatter reference, best practices from real-world usage, and three worked examples.

---

## Anatomy of a Prompt File

Every prompt file has two parts separated by YAML frontmatter delimiters (`---`).

```
---
id: my-prompt-id
title: "My Prompt"
order: 1
---

The actual prompt text goes here.
Claude reads everything below the second --- delimiter.
```

**Part 1 — Frontmatter:** Machine-readable metadata between the opening and closing `---` lines. Controls execution behavior: ordering, timeouts, retry policy, Guardian settings, and checkpointing. Conductor's plan loader validates every frontmatter field before a run starts.

**Part 2 — Body:** Everything after the closing `---`. This is the verbatim text sent to Claude via stdin. Claude does not see the frontmatter — only the body. Write the body as if you are giving instructions to a senior engineer in plain language.

---

## Complete Frontmatter Reference

```yaml
---
id: my-prompt-id          # Required: unique identifier within the plan
title: "My Prompt"         # Required: human-readable title shown in the UI
order: 1                   # Optional: execution order (1-based, auto-assigned if omitted)
depends_on: []             # Optional: list of prompt IDs that must complete first
working_dir: ./src         # Optional: override the run-level working directory
timeout: 300               # Optional: seconds before Conductor kills the process (default: 300)
retry:
  max_attempts: 3          # Optional: total attempts including first (default: 1 = no retry)
  delay_seconds: 10        # Optional: base delay between attempts (exponential backoff applied)
guardian:
  auto_approve: true       # Optional: skip all Guardian review for this prompt
  risk_level: low          # Optional: low | medium | high (affects Guardian strategy)
skip_on_error: false       # Optional: continue the run even if this prompt ultimately fails
checkpoint: true           # Optional: create a Git commit after this prompt succeeds
---
```

### Field Details

**`id`** (string, required)

Unique identifier for this prompt within the plan. Used in `depends_on` references, checkpoint commit messages, database records, and log lines. Use kebab-case. Must be unique across all prompts in the plan.

```yaml
id: add-unit-tests
```

**`title`** (string, required)

Human-readable label shown in the Run Viewer step list, the Plan Editor, and insight reports. Keep it short and descriptive.

```yaml
title: "Add unit tests for auth module"
```

**`order`** (integer, optional)

Explicit 1-based execution position. If omitted, Conductor assigns order based on the alphabetical/numeric sort of filenames (e.g. `01-setup.md`, `02-implement.md`, `03-test.md`). Explicit `order` values override filename-based ordering. Gaps are allowed (`order: 10`, `order: 20`) to leave room for future inserts.

```yaml
order: 3
```

**`depends_on`** (array of strings, optional)

List of prompt IDs that must reach `succeeded` status before this prompt starts. Conductor enforces this as a prerequisite check — if a dependency failed, this prompt is skipped with status `blocked`. Use this for branching workflows where some prompts are independent but others need earlier results.

```yaml
depends_on:
  - scaffold-project
  - add-dependencies
```

**`working_dir`** (string, optional)

Overrides the run-level working directory for this specific prompt only. Useful when a plan orchestrates changes across multiple sub-projects in a monorepo. Relative paths are resolved from the run-level working directory root.

```yaml
working_dir: ./packages/api
```

**`timeout`** (integer, optional, default: 300)

Maximum seconds Conductor will wait for Claude to complete this prompt before killing the process and marking the execution as failed. Increase for prompts that generate large amounts of code or run expensive operations. Decrease for simple prompts to fail fast.

```yaml
timeout: 600   # 10 minutes for a large refactor
```

**`retry`** (object, optional)

Controls automatic retry behavior when a prompt fails. `max_attempts` is the total number of attempts including the first (so `max_attempts: 3` means one initial attempt plus two retries). `delay_seconds` is the base delay; Conductor applies exponential backoff (`base * 2^attempt_index`) with jitter between retries.

```yaml
retry:
  max_attempts: 3
  delay_seconds: 15
```

**`guardian.auto_approve`** (boolean, optional)

When `true`, the Guardian auto-approves all questions Claude raises during this prompt without consulting any strategy or requiring human input. Use for prompts where you have high confidence in Claude's judgment and want maximum speed. When `false` (default), the configured Guardian strategy applies.

```yaml
guardian:
  auto_approve: true
```

**`guardian.risk_level`** (enum, optional)

Signals the expected risk of this prompt to the Guardian strategy engine. Valid values: `low`, `medium`, `high`.

- `low` — Guardian auto-approves in `balanced` strategy mode
- `medium` — Guardian may ask clarifying questions in `balanced` mode
- `high` — Guardian escalates to human review in any non-permissive mode

If omitted, the Guardian infers risk level from question content.

```yaml
guardian:
  risk_level: high
```

**`skip_on_error`** (boolean, optional, default: false)

When `true` and this prompt fails after all retry attempts are exhausted, Conductor marks this execution as `skipped` and continues to the next prompt rather than failing the entire run. Use carefully — subsequent prompts that depend on this prompt's output may produce incorrect results.

```yaml
skip_on_error: true
```

**`checkpoint`** (boolean, optional)

When `true`, Conductor creates a Git commit in the working directory immediately after this prompt succeeds. The commit message encodes the run ID, prompt ID, and step counter:

```
conductor: run=abc123 prompt=add-unit-tests step=3/8
```

Checkpoints are the foundation of Conductor's rollback capability. You can roll the working directory back to any checkpoint from the Run Viewer. Set `checkpoint: true` on any prompt that makes significant, verifiable changes. See the checkpoint documentation for details on the commit structure.

```yaml
checkpoint: true
```

---

## Best Practices

### Keep Prompts Focused on One Task

Claude performs best when each prompt has a single, clear objective. Resist the temptation to bundle multiple tasks into one prompt — split them into separate files instead. This makes failures easier to diagnose, retries cheaper, and the Git history cleaner.

**Too broad:**
```
Refactor the authentication module, add tests, update the documentation, and deploy to staging.
```

**Better — split into four prompts:**
```
Prompt 1: Refactor the authentication module
Prompt 2: Write unit tests for the refactored auth module
Prompt 3: Update the authentication documentation
Prompt 4: Run the deployment script for staging
```

### Write Explicit, Verifiable Success Criteria

Claude works best with prompts that include a clear definition of done. Vague prompts produce vague output.

**Vague:**
```
Fix the bug in the payment module.
```

**Explicit:**
```
In `packages/payments/src/stripe.ts`, the `chargeCard` function throws an
unhandled exception when the card is declined. 

Fix the exception handling so that:
1. A declined card returns `{ success: false, code: "card_declined" }`
2. No exception propagates to the caller
3. The existing unit tests in `packages/payments/src/__tests__/stripe.test.ts` still pass

Do not modify any other files.
```

### Use Checkpoints Strategically

Enable `checkpoint: true` on prompts that make meaningful, self-contained changes. A good rule of thumb: if you would want to be able to roll back to exactly this state, checkpoint it.

Good checkpointing candidates:
- After scaffolding a new module or feature
- After a large refactor
- After tests pass for the first time
- Before and after any prompt that deletes or renames files

Avoid checkpointing trivial prompts (formatting-only changes, comment updates) unless you need the granularity.

### Set Timeouts Based on Actual Complexity

The default 300-second timeout is appropriate for most prompts. Use these guidelines:

| Task Type | Recommended Timeout |
|---|---|
| Documentation / comments | 60–120s |
| Small bug fix (< 50 lines) | 120–300s |
| Medium feature (< 300 lines) | 300–600s |
| Large refactor or generation | 600–900s |
| Full test suite generation | 900–1800s |

Overly generous timeouts mask real failures — if Claude is stuck, you want to know quickly. Set the timeout to roughly 2x the time you expect the task to take.

### Use `depends_on` for Complex Workflows

Dependencies prevent a prompt from running before its prerequisites are ready. This is especially useful when:
- A later prompt references files created by an earlier one
- You want a test prompt to only run after the implementation is complete
- Error handling prompts should only execute if a specific earlier step succeeded

```yaml
---
id: run-tests
title: "Run the test suite"
depends_on:
  - implement-feature
  - write-tests
checkpoint: true
---
Run `pnpm test` and fix any failures. Do not proceed until all tests pass.
```

### Match `risk_level` to Actual Risk

The Guardian's behavior is tuned by risk level. Be honest about what a prompt does:

- `low` — Read-only analysis, documentation, adding new files in isolation
- `medium` — Modifying existing files, adding dependencies, config changes
- `high` — Deleting files, changing database schemas, modifying auth/security logic, deployment scripts

Setting everything to `low` to avoid Guardian questions defeats the purpose of the Guardian.

---

## Variables and Placeholders

### Environment Variables

Reference environment variables in prompt bodies using `${VAR_NAME}` syntax. Conductor resolves these from the environment at run time before sending the prompt to Claude.

```yaml
---
id: configure-database
title: "Configure database connection"
---
Update the database configuration in `src/config/database.ts` to use the connection
string from `${DATABASE_URL}`. Make sure the connection pool size is set to
`${DB_POOL_SIZE:-10}` (default to 10 if the variable is not set).
```

> **Note:** Only environment variables available in the worker process are accessible. Do not use this for secrets that should not appear in prompt text — Claude sees the resolved value.

### Plan-Level Variables (Future)

Support for plan-level variable definitions (set once, referenced across all prompts) is planned for a future release. Currently, use environment variables for shared values.

---

## Worked Examples

### Example 1 — Refactor a File

```markdown
---
id: refactor-user-service
title: "Refactor UserService to use repository pattern"
order: 1
timeout: 600
retry:
  max_attempts: 2
  delay_seconds: 30
guardian:
  risk_level: medium
checkpoint: true
---
Refactor `src/services/UserService.ts` to use the repository pattern.

Specifically:
1. Create a new file `src/repositories/UserRepository.ts` that encapsulates
   all direct database calls currently in UserService.
2. Update `UserService.ts` to depend on `UserRepository` via constructor
   injection (not direct instantiation).
3. Update `src/index.ts` to wire up the dependency.
4. Do NOT change the public interface of UserService — all existing callers
   must continue to work without modification.
5. Ensure TypeScript strict mode passes with no new errors.

Do not modify any test files.
```

### Example 2 — Write Tests

```markdown
---
id: write-auth-tests
title: "Write unit tests for auth module"
order: 4
depends_on:
  - refactor-user-service
timeout: 900
retry:
  max_attempts: 3
  delay_seconds: 15
guardian:
  auto_approve: true
  risk_level: low
checkpoint: true
---
Write a comprehensive unit test suite for `src/services/AuthService.ts`.

Requirements:
- Use Vitest as the test framework (already in devDependencies)
- Place tests at `src/services/__tests__/AuthService.test.ts`
- Cover the following scenarios:
  1. `login()` — success case returns a JWT
  2. `login()` — wrong password returns null (no exception)
  3. `login()` — unknown user returns null
  4. `logout()` — clears the session
  5. `refreshToken()` — returns a new token when the old one is valid
  6. `refreshToken()` — returns null when the old token is expired

- Mock the UserRepository using `vi.mock`
- All tests must pass: run `pnpm test --filter=AuthService` and fix any
  failures before finishing.
- Aim for 100% branch coverage on the public methods.
```

### Example 3 — Update Documentation

```markdown
---
id: update-api-docs
title: "Update API documentation"
order: 8
depends_on:
  - implement-endpoints
timeout: 300
guardian:
  risk_level: low
checkpoint: false
---
Update `docs/api-reference.md` to reflect the new endpoints added in the
previous step.

For each new endpoint, document:
- HTTP method and path
- Request body schema (TypeScript interface format)
- Response body schema
- Possible error codes and their meanings
- One curl example

Format the documentation to match the existing style in the file. Do not
remove or reformat any existing endpoint documentation.

After updating, also update the endpoint count in the README.md badge
(search for `endpoints-` in the file).
```

---

## Organizing a Plan's Files

There is no enforced naming convention, but the following pattern works well for most plans:

```
my-plan/
  01-scaffold.md
  02-implement-core.md
  03-add-tests.md
  04-update-docs.md
  05-smoke-test.md
```

The numeric prefix ensures the files sort in execution order in your file browser and in Git history. If you use explicit `order:` in frontmatter, the numeric prefix is optional but still helpful for human readers.

---

## Related Documentation

- [Frontmatter Reference](../reference/frontmatter.md) — Full field reference table
- [Configure Guardian](./configure-guardian.md) — Tune auto-decision behavior per plan
- [Debug a Failed Run](./debug-failed-run.md) — What to do when a prompt fails

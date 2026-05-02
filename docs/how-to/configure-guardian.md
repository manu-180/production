# How to Configure Guardian

## What is Guardian?

During a run, Claude sometimes pauses to ask a clarifying question before proceeding. Examples:

- "Should I overwrite the existing configuration file?"
- "Should I use PostgreSQL or SQLite for this?"
- "The function signature changed — should I update all 47 call sites?"

Without an automated response, these questions would stall a fully autonomous run indefinitely. Guardian is Conductor's automated decision agent that intercepts these questions, evaluates them against a configurable policy, and responds on your behalf — keeping the run flowing without your constant attention.

Guardian is not a simple "always say yes" bot. It uses a three-layer strategy cascade:

1. **Rules strategy** — Pattern-matching against a library of canonical question shapes (overwrite prompts, tech-choice questions, destructive operations). Fast, deterministic, zero API cost.
2. **Defaults strategy** — Conservative fallbacks for unrecognized questions. Used when no rule matches.
3. **LLM strategy** — A small Claude API call with the question and run context. Used when the question is genuinely ambiguous and no rule or default applies.

Every decision — regardless of which strategy made it — is persisted to the database with the question text, the answer provided, the reasoning, the confidence score, and the strategy that resolved it. You can audit and tune Guardian's behavior from the **Insights → Guardian** page.

---

## Guardian Decision Flow

```
Claude asks a question
        |
        v
Rules Strategy — does a pattern match?
    Yes -> respond with rule-defined answer
    No  -> fall through
        |
        v
Defaults Strategy — is this a recognized question shape?
    Yes -> respond with conservative default
    No  -> fall through
        |
        v
LLM Strategy — call Claude with question + run context
    confidence >= 0.7 -> respond automatically
    confidence < 0.7  -> pause run, notify user for human review
        |
        v
Human Review (if required)
    User approves/denies/provides instructions
    Run resumes with decision recorded
```

---

## Per-Prompt Configuration

Control Guardian behavior for individual prompts via frontmatter in your prompt files.

### `guardian.auto_approve`

Bypasses all Guardian logic for this prompt. Claude's questions are answered with a generic "proceed as you think best" reply. Use for prompts where you have high confidence in Claude's judgment.

```yaml
---
id: format-code
title: "Run prettier on all files"
guardian:
  auto_approve: true
---
Run `pnpm format` across the entire repository.
```

**When to use:** Low-stakes, reversible operations. Formatting, comment updates, documentation generation. Never use `auto_approve: true` on prompts that delete files, modify schemas, or touch authentication logic.

### `guardian.risk_level`

Provides a hint to the Guardian strategy about the expected risk of this prompt. The strategy uses this in combination with question analysis to decide how aggressively to auto-answer.

```yaml
guardian:
  risk_level: low | medium | high
```

| Risk Level | Guardian Behavior (balanced strategy) |
|---|---|
| `low` | Auto-approve most questions, only block clearly dangerous ones |
| `medium` | Auto-approve safe questions, ask on ambiguous ones |
| `high` | Require human review for any non-trivial question |

If `risk_level` is not set, Guardian infers it from the content of each question as it arrives.

---

## Global Guardian Settings

Configure Guardian defaults for all plans via **Settings → Guardian** in the dashboard.

### Strategy Mode

The strategy mode controls Guardian's overall posture. Set it once globally; per-prompt `risk_level` adjusts within that posture.

**`conservative`**
- Blocks all destructive operations (file deletion, git reset, schema drops)
- Asks on any ambiguous question rather than guessing
- Suitable for: production environments, shared codebases, when you are learning how Claude operates in your codebase

**`balanced`** (default)
- Auto-approves questions with confidence >= 0.7 and risk_level `low`
- Asks on medium-confidence or medium-risk questions
- Blocks clearly dangerous operations
- Suitable for: most use cases

**`permissive`**
- Only blocks operations that are unambiguously dangerous (mass deletion, credential exposure)
- Auto-approves everything else with confidence >= 0.5
- Suitable for: sandboxed environments, disposable test repositories, trusted automation pipelines

### Auto-Approve Low-Risk Threshold

Set a confidence threshold below which Guardian always escalates to human review, regardless of risk level. Default: 0.7. Range: 0.0–1.0.

If a Guardian decision has confidence 0.65 and your threshold is 0.7, the run pauses and you receive a notification.

### Notification Settings

Configure where Guardian sends notifications when it needs human input:

- **In-app** — Desktop push notification (browser permission required)
- **Webhook** — POST to a configured endpoint (Slack, custom)

See **Settings → Integrations** for webhook configuration.

### Human Review Timeout

If Guardian requires human review and no response is received within the configured timeout (default: 3600 seconds / 1 hour), the run is automatically paused. The run remains in `paused` status indefinitely until you respond — it will not auto-cancel.

---

## When Guardian Requires Human Review

When confidence is below threshold (or `risk_level: high` and the question is non-trivial), the run enters a `waiting` state. Here is the full flow:

1. **Run pauses** at the current prompt's execution. The Claude subprocess is kept alive — its stdin is held open waiting for the Guardian's response.

2. **Notification sent** to your configured channels (in-app push, webhook).

3. **Guardian panel in Run Viewer** shows:
   - The question Claude asked (verbatim)
   - The strategy that flagged it for human review and why
   - The confidence score
   - Up to 3 suggested responses from the LLM strategy (ranked by confidence)

4. **You choose one of three actions:**
   - **Approve** — Accept one of the suggested responses. Guardian sends it to Claude.
   - **Deny / Block** — Tell Claude not to proceed with the operation. Guardian sends a "do not do this" reply.
   - **Provide Instructions** — Type a custom response. Guardian sends your text verbatim to Claude.

5. **Run resumes.** The decision is recorded in the database with your choice, a timestamp, and a flag indicating it was human-reviewed. The Guardian audit log shows all decisions for the run.

---

## Reading the Guardian Audit Log

The Guardian audit log at **Insights → Guardian** shows every decision across all runs. Each row includes:

| Column | Description |
|---|---|
| Run | The run and prompt where the question occurred |
| Question | The verbatim question Claude asked |
| Decision | The answer Guardian provided |
| Strategy | `rule`, `default`, or `llm` |
| Confidence | 0.0 – 1.0 |
| Reviewed | Whether a human reviewed this decision |
| Reasoning | Why this strategy produced this answer |

Use the audit log to:
- Identify patterns where Guardian made wrong calls
- Find prompts that consistently trigger low-confidence decisions (candidates for rewriting)
- Tune your global strategy based on real behavior

---

## Tuning Guardian for Your Codebase

### Reduce false escalations on `high`-risk prompts you trust

If a prompt reliably receives high-risk classification but you have validated that its actions are safe in your context, set `auto_approve: true` for that specific prompt. Document why in a comment in the frontmatter.

### Speed up low-stakes runs

For plans that only create new files (never modify or delete), set `guardian.risk_level: low` on every prompt. This keeps Guardian active as a safety net while minimizing interruptions.

### Handle recurring questions with custom rules

If Claude consistently asks the same question in your codebase (e.g. "Should I use tabs or spaces?"), the LLM strategy will eventually learn the pattern. In a future release, custom rule definitions will allow you to encode your preferences as explicit patterns. For now, the most effective approach is to encode the answer in the prompt body itself:

```markdown
Always use 2-space indentation. If asked about formatting, use prettier with
the project's existing .prettierrc configuration.
```

Front-loading your preferences in the prompt body is the most reliable way to prevent Guardian from ever seeing a question in the first place.

---

## Related Documentation

- [Writing Prompts](./write-prompts.md) — Frontmatter reference including `guardian` fields
- [Frontmatter Reference](../reference/frontmatter.md) — Quick lookup table for all fields
- [Debug a Failed Run](./debug-failed-run.md) — What to do when Guardian blocks a run

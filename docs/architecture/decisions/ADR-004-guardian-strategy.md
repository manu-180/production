# ADR-004: Two-Tier Guardian Strategy for Auto-Answering Claude Questions

## Status
Accepted

## Date
2026-04-29

## Context
Claude Code CLI is interactive by design. During a run, Claude often asks the operator questions: "Should I proceed with this destructive change?", "Which file did you mean — `auth.ts` or `auth.tsx`?", "Do you want me to install the missing dependency?". In manual use a human answers; in Conductor's headless model, an unanswered question stalls the run indefinitely and defeats the entire purpose of automation.

Conductor needs a Guardian component that detects when Claude is waiting on a question and supplies a reasonable answer automatically. The challenge is twofold: false negatives (failing to detect a question) cause silent stalls, and false positives (answering when Claude was just thinking) can corrupt the conversation by injecting irrelevant input. Additionally, latency matters — every question we answer slowly adds dead time to the run, but every wrong answer wastes a prompt's worth of work.

Different question types warrant different effort. A simple "Yes/No, proceed?" can be answered by a regex with high confidence. A nuanced "There are three plausible approaches; which fits your codebase?" needs reasoning over context. A one-size-fits-all approach either over-spends on trivial cases or under-thinks the hard ones.

## Decision
Implement a two-tier Guardian:

**Tier 1 — Heuristics.** A pattern-matching layer inspects the last assistant message for known question shapes (yes/no questions, file path requests, permission prompts, common confirmations). Each match produces a candidate answer plus a confidence score. If confidence > 0.85, the Guardian answers immediately with a best-practices response and logs the decision.

**Tier 2 — LLM fallback.** If heuristic confidence is ≤ 0.85, the Guardian invokes Claude Haiku (via the same `claude -p` mechanism, so it draws from subscription quota rather than API credits — see ADR-001) with the full context and a structured prompt asking for a reasoned answer. The LLM's response is logged with its reasoning.

Every Guardian decision — regardless of tier — is persisted with: tier used, detected question text, reasoning, chosen answer, and confidence score. The dashboard surfaces these so users can audit Guardian behavior and tune thresholds.

## Consequences
### Positive
- Trivial questions are answered in milliseconds with no LLM cost — the common case stays fast.
- Hard questions get reasoning, not a brittle regex guess — accuracy where it matters.
- Full audit trail: every decision is inspectable, which builds trust and enables threshold tuning.
- The 0.85 confidence floor on tier 1 prevents the worst failure mode (confident wrong answer on an ambiguous case) by deferring to tier 2 when uncertain.

### Negative
- Two code paths to maintain (heuristic library and LLM prompt template). Both must be kept correct as Claude's question patterns evolve.
- Tier 2 calls cost subscription quota and add seconds of latency. Frequent fallback indicates heuristics are too narrow and needs investigation.
- Prompt-injection risk: a malicious or buggy Claude response could attempt to manipulate the Guardian's LLM call. Mitigated by structured prompts and answer validation, but worth tracking.

### Neutral / Risks
- Threshold value (0.85) is initial; it must be tuned against measured outcomes once we have production data.
- "Best-practices answer" for tier 1 is a small policy surface — what does "yes proceed" mean for a destructive operation? We default to safe answers (decline destructive actions, prefer non-mutating choices) and let users override per-run.
- Guardian metrics (% LLM fallback, % overridden by user, false-positive rate) become a first-class dashboard feature.

## Alternatives Considered
### Alternative 1: Pure heuristics only
**Description:** Use regex and pattern matching exclusively, no LLM fallback.
**Rejected because:** Regex is brittle for the long tail of question phrasings. Coverage gaps lead to silent stalls or wrong answers on novel phrasings. The cost of maintaining ever-growing pattern lists exceeds the cost of a Haiku call on the rare hard cases.

### Alternative 2: Always use LLM
**Description:** Skip heuristics and call Claude Haiku for every detected question.
**Rejected because:** Most questions in practice are trivial yes/no or "proceed?" prompts where heuristics give the right answer instantly. Calling an LLM for every one of them adds seconds to every prompt, multiplies subscription quota usage, and erodes the perceived snappiness of the product.

### Alternative 3: Pause run and ask the human
**Description:** When a question is detected, pause the run and notify the user to answer manually.
**Rejected because:** It defeats the purpose of automation. Conductor's value proposition is unattended sequential execution; requiring human intervention mid-run turns it into a glorified terminal multiplexer. We may offer this as an opt-in mode for sensitive runs, but it cannot be the default.

## Open Questions
- What is the right answer policy for ambiguous destructive operations — always decline, always defer to LLM, or expose a per-run "aggressiveness" setting?
- How do we evaluate Guardian quality without ground truth? Likely a combination of user-override rate and post-run human spot-checks; needs an evaluation harness.
- Should tier 2 use Haiku consistently, or should it scale up to Sonnet for high-stakes runs? Start with Haiku, measure accuracy, escalate if needed.

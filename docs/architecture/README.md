# Conductor — Architecture Overview

## What is Conductor

Conductor is a local-first orchestration tool that automates the sequential execution of development plans using the Claude Code CLI in headless mode (`claude -p --output-format stream-json`). Instead of pasting prompts one-by-one into a terminal or chat window, users author a **Plan** as a folder of ordered Markdown prompts, point Conductor at a target working directory, and let it drive Claude through the full sequence — autonomously, observably, and recoverably.

The core value proposition is leveraging a **Claude Max subscription** ($200/mo, OAuth long-lived token) to run long, multi-step coding tasks without paying per-token Console API rates. The same Claude account that powers interactive sessions in Claude Code becomes the engine for batch automation. Conductor never touches an Anthropic Console API key — it spawns the `claude` CLI as a subprocess, authenticated with `claude setup-token`, and parses its `stream-json` stdout in real time.

What sets Conductor apart from a shell script wrapper is its **Guardian agent** and **Checkpoint** system. When Claude pauses mid-execution to ask an ambiguous clarifying question ("Should I use Postgres or SQLite?", "Overwrite the existing file?"), the Guardian intercepts, applies a heuristics-plus-LLM decision policy, logs its reasoning, and replies on the user's behalf — keeping the run flowing. After every successful prompt, Conductor creates a structured git commit so the entire run becomes a clean, bisectable history. If a prompt fails after retries, the Recovery module rolls the working directory back to the last good checkpoint and marks the run for inspection.

The result is a tool that turns a folder of prompts into a fully automated, fully observable build pipeline — with a premium real-time dashboard, resumable runs, and zero cloud lock-in beyond Supabase for state and realtime fan-out.

## Architecture Overview

Conductor is a three-tier local-first application: a Next.js 15 frontend (App Router, Tailwind, shadcn/ui), a thin API layer of Next.js Route Handlers, and a long-lived Node.js worker process that spawns Claude CLI children via `child_process`. State and realtime fan-out live in Supabase (Postgres + Realtime + Auth). Git operations use `simple-git` against the user-specified working directory. Logging is structured via Pino. Tests are split across Vitest (unit/integration) and Playwright (E2E). The whole stack ships as a Docker Compose bundle for one-command local deployment.

## Key Components

- **UI Layer (Next.js):** Dashboard, Plan Editor, and Run Viewer — the operator surface for authoring plans and watching runs live.
- **API Layer (Next.js Route Handlers):** Thin REST endpoints for plan CRUD, run lifecycle, and an SSE bridge for streaming updates to the browser.
- **Worker Process (Node.js):** Long-lived process that owns the run queue and the Claude CLI child processes. Decoupled from API request lifecycle.
- **Executor (core module):** Spawns `claude -p`, pipes stdin/stdout, parses `stream-json` events, emits structured updates.
- **Orchestrator (core module):** Walks a Plan's prompts in order, invokes the Executor per prompt, owns run-level state transitions.
- **Guardian (core module):** AI agent that intercepts ambiguous questions from Claude, applies decision heuristics + LLM fallback, logs reasoning, replies via stdin.
- **Checkpoint (core module):** Wraps `simple-git` to commit after each successful prompt and roll back on terminal failure.
- **Recovery (core module):** Retry-with-exponential-backoff on transient failures; escalates to rollback when retry budget is exhausted.
- **Claude CLI (external):** The execution engine. Invoked headless with `--output-format stream-json`. Authenticated via OAuth subscription token.
- **Git (external, via simple-git):** Source-of-truth for the working directory. Every checkpoint is a real commit.
- **Supabase (external):** Postgres for durable state (plans, runs, executions, events), Realtime for fan-out to the UI, Auth for operator login.

## Design Principles

1. **Subscription-first** — never use an Anthropic Console API key. Always authenticate via OAuth long-lived subscription token (`claude setup-token`). The economic model of Conductor depends on this.
2. **Resumability** — any execution can pause and resume without losing state. Run state, prompt cursor, and checkpoint pointer are all persisted in Supabase, so a worker crash or operator restart never corrupts a run.
3. **Idempotency** — re-running a prompt won't break anything. Git checkpointing means every prompt's output is captured as a commit; replaying a prompt either reproduces the same diff or surfaces a real disagreement worth investigating.
4. **Total Observability** — everything logged, queryable, exportable. Every Claude stdout event, every Guardian decision, every git operation lands in Postgres with a timestamp and a structured payload. Pino writes a parallel JSON log to disk for offline forensics.
5. **Auto-decision with criteria** — the Guardian uses heuristics first (regex/keyword matching against known question shapes), falls back to a small LLM call when ambiguous, and **always logs its reasoning**. No silent decisions. Operators can review the decision trail and tune heuristics.
6. **Fail loud, recover smart** — clear, actionable errors surface in the UI within milliseconds. Underneath, the Recovery module retries transient failures with exponential backoff before escalating. No silent swallowing, no infinite loops.
7. **Local-first** — runs on the operator's machine. The Claude CLI, the working directory, the git repo, and the Node worker are all local. The only network dependency is Supabase (state + realtime), which itself can run locally via `supabase start`.
8. **Premium UX** — the dashboard is not an afterthought. Smooth animations, immediate feedback on every action, real-time streams that feel like a terminal but read like a story. Built on shadcn/ui + Tailwind for a coherent, modern surface.

## Glossary

- **Plan** — A collection of ordered prompt files (typically `.md` with frontmatter metadata) that define a multi-step task. Authored once, run many times.
- **Run** — A single execution of a Plan against a specific working directory. Has a lifecycle: `queued → running → completed | failed | cancelled`.
- **Prompt** — One `.md` file inside a Plan. Contains the natural-language instructions handed to Claude. Frontmatter carries metadata (timeout, retry policy, expected outputs).
- **Execution** — One attempt to run a single Prompt within a Run. A Prompt may have multiple Executions if Recovery retries it.
- **Checkpoint** — A git commit created after each successful Prompt Execution. The commit message is structured (run id, prompt id, timestamp) so the run history is machine-readable.
- **Guardian** — The AI agent that auto-responds to ambiguous questions Claude raises mid-stream. Uses heuristics + LLM, always logs its reasoning.
- **Working Dir** — The target directory where Claude makes code changes. Conductor never operates outside this directory; all git operations are scoped to it.
- **Worker** — The long-lived Node.js process that owns the run queue, spawns Claude CLI children, and coordinates the Executor / Orchestrator / Guardian / Checkpoint / Recovery modules.

## Quick Links

- [Component Architecture](./components.md) — Mermaid component diagram and per-component responsibilities.
- [Data Flow](./data-flow.md) — Sequence diagram of a complete run lifecycle.
- [Architecture Decisions](./decisions/) — ADRs documenting the why behind key technical choices.

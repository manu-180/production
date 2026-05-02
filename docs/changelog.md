# Changelog

All notable changes to Conductor are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Conductor follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Phase 15: End-to-end testing with Playwright covering run lifecycle, Guardian decisions, and rollback flows
- Docker Compose production configuration with health checks for all services
- GitHub Actions CI/CD pipelines for lint, typecheck, unit tests, and E2E tests
- Deployment scripts: `setup.sh` (one-shot environment setup), `backup.sh` (database + config export), `healthcheck.sh` (service health probe), `smoke.sh` (post-deploy smoke test)
- Complete documentation suite: getting started guide, how-to guides, reference tables, FAQ, and troubleshooting

---

## [0.1.0] — 2026-05-01

### Added

**Infrastructure (Phase 01)**
- Monorepo setup with Turborepo and pnpm workspaces
- `apps/web` (Next.js 16, App Router, Tailwind 4, shadcn/ui)
- `apps/worker` (Node.js, tsx, Pino structured logging)
- `packages/core` (shared types, `Result<T,E>`, logger)
- `packages/db` (Supabase typed client)
- Biome for lint + format, lefthook for pre-commit hooks, commitlint for conventional commits

**Database (Phase 02)**
- Supabase Postgres schema with 18 migrations
- Tables: `plans`, `prompts`, `runs`, `executions`, `events`, `guardian_decisions`, `worker_status`, `schedules`, `webhooks`, `notifications`, `audit_log`
- Row Level Security policies scoped per authenticated user
- Realtime publication on `runs`, `executions`, `events`, and `guardian_decisions` for live dashboard updates
- Supabase Auth integration

**Authentication (Phase 03)**
- Claude OAuth token management with AES-256-GCM encryption at rest
- Token stored encrypted in Supabase; never logged or exposed to browser after initial entry
- `CONDUCTOR_ENCRYPTION_KEY` environment variable as the encryption master key
- Token rotation support via Settings UI

**Executor (Phase 04)**
- Claude CLI wrapper: spawns `claude -p --output-format stream-json` as a child process
- Streaming JSON parser for real-time event extraction from Claude stdout
- Event types: `assistant_message`, `tool_use`, `tool_result`, `input_required`, `result`
- Stdin pipe for writing prompt text and Guardian replies to Claude
- Graceful process termination with timeout enforcement

**Plan Loader (Phase 05)**
- YAML/Markdown frontmatter parser for prompt files
- Validation of required fields (`id`, `title`) and optional fields with defaults
- Dependency graph construction from `depends_on` declarations
- Circular dependency detection at plan load time
- Filename-based auto-ordering when explicit `order` is omitted

**Orchestrator (Phase 06)**
- Sequential prompt execution state machine: `queued → running → completed | failed | cancelled`
- Dependency resolution: prompts blocked by failed dependencies are marked `blocked` and skipped
- `skip_on_error` support: optional continuation after prompt failure
- Run-level state transitions with database persistence on every state change
- SSE bridge: every Executor event streamed to Supabase Realtime for UI consumption

**Guardian (Phase 07)**
- Automatic interception of `input_required` events from the Claude stream
- Three-layer decision strategy cascade: rules → defaults → LLM
- Rules strategy: regex/keyword pattern matching against 20+ canonical question shapes
- Defaults strategy: conservative fallback answers for recognized but unmatched questions
- LLM strategy: small Claude API call with question + run context for genuinely ambiguous questions
- Confidence scoring with configurable human-review threshold (default: 0.7)
- Full audit logging: every decision persisted with question, answer, strategy, confidence, and reasoning
- Per-prompt `guardian.auto_approve` and `guardian.risk_level` frontmatter controls
- Global strategy mode: `conservative`, `balanced` (default), `permissive`

**Checkpoint (Phase 08)**
- Git-based state snapshots after each successful prompt execution
- `git add -A && git commit` with structured message: `conductor: run=<id> prompt=<id> step=N/M`
- Commit SHA persisted to `executions` row
- Rollback: `git reset --hard <sha>` to restore working directory to any checkpoint
- Diff viewer: per-checkpoint diff available in Run Viewer
- Empty-commit detection: no commit created if working directory has no changes

**Recovery (Phase 09)**
- Error classifier: maps executor errors to recovery categories (transient, permanent, rate-limit, auth)
- Retry policy: configurable `max_attempts` and `delay_seconds` with exponential backoff + jitter
- Circuit breaker: trips after N consecutive failures, enters half-open state for trial recovery
- Rate limit handler: parses `Retry-After` headers and waits before retrying
- Worker heartbeat: publishes `worker_status` to Supabase every 10 seconds
- Crash recovery: on worker startup, detects orphaned runs and resumes from last checkpoint
- Resumability: compute resume point and flip run status from any terminal or paused state

**API (Phase 10)**
- 20+ REST endpoints covering: plans CRUD, prompts CRUD, runs lifecycle, Guardian decisions, schedules, webhooks, settings, system health
- Next.js Route Handlers with typed request/response via `@conductor/core` contracts
- SSE endpoint (`/api/runs/[id]/stream`) for real-time run event delivery
- OpenAPI documentation at `/api-docs`
- Request validation with structured error responses

**UI Dashboard (Phase 11)**
- Live Run Viewer: real-time token stream, step progress, Guardian panel, checkpoint timeline
- Runs list with status filtering and search
- KPI analytics: total runs, success rate, average duration, cost per run, Guardian intervention rate
- Guardian Insights: decision strategy breakdown, confidence trends, intervention frequency
- Prompt leaderboard: average duration and success rate per prompt across all runs
- Cost tracking: token usage and estimated cost per run and over time
- Onboarding wizard: Claude token entry, working directory configuration, verification

**UI Editor (Phase 12)**
- Plan list with create, edit, delete, and run actions
- Prompt editor: split-pane view with frontmatter form (validated) and body text editor
- YAML frontmatter validation with inline error display
- Lint panel: plan-level validation (missing IDs, circular dependencies, invalid timeouts)
- Prompt reordering via drag-and-drop
- Template grid: pre-built plan templates for common use cases
- Upload zone: drag-and-drop folder upload for importing existing prompt file sets
- Plan export: download plan as a zip of Markdown files

**Integrations (Phase 12)**
- Webhook notifications: configurable POST to Slack or custom HTTP endpoints on run complete/fail
- Scheduled runs: cron syntax scheduling via Settings → Schedules, using `node-cron`
- Desktop push notifications: browser Notification API for Guardian review requests

### Technical Notes

- All TypeScript in strict mode; no `any` in production code
- `Result<T,E>` monad used throughout core modules — no unhandled promise rejections
- Pino structured JSON logging in all worker and API code; log level controlled by `LOG_LEVEL` env var
- Supabase Realtime used exclusively for fan-out; the worker never pushes directly to the web client
- Claude OAuth token decrypted in-memory at run start; not persisted to disk in plaintext at any point
- Git operations use `simple-git` library; all operations scoped to the configured working directory

[Unreleased]: https://github.com/your-org/conductor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-org/conductor/releases/tag/v0.1.0

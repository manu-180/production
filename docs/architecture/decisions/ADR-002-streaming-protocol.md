# ADR-002: Streaming Protocol via stream-json and Supabase Realtime

## Status
Accepted

## Date
2026-04-29

## Context
Conductor's user-facing value depends on showing Claude's output as it happens — token-by-token, tool-call-by-tool-call — in a Next.js dashboard. A run can take minutes to hours, may span dozens of prompts, and the user expects a live feed comparable to running `claude` in their own terminal. Latency matters, but durability matters more: if the user closes the browser tab or their wifi flickers, they should be able to come back and see what happened during the disconnection without losing events.

Claude Code CLI exposes a structured streaming output mode (`--output-format stream-json`) that emits one JSON object per line over stdout, covering message deltas, tool invocations, tool results, and lifecycle events. The Worker process needs to (1) parse these events as they arrive, (2) persist them so the UI can replay history, and (3) push them live to any connected client. Supabase Realtime is already a core dependency for the product (we use Postgres as the source of truth — see ADR-003) and provides a durable event bus with automatic resubscription.

Choosing the wrong streaming architecture is expensive to undo: it shapes the database schema, the client data layer, and the network topology between Worker, API, and browser.

## Decision
Spawn `claude -p` with `--output-format stream-json`. The Worker reads stdout line-by-line, parses each event into a typed object, and writes it to the appropriate Supabase tables (e.g. `events`, `prompt_executions`). Supabase Realtime then fans out the changes to subscribed clients. The browser uses the Supabase JS client to subscribe directly to Realtime channels for the active run.

For clients that cannot use the Supabase client directly (e.g. third-party integrations, future CLI viewers), the API layer exposes an SSE endpoint at `/api/runs/[id]/stream` that subscribes to Supabase Realtime server-side and proxies events as Server-Sent Events. Worker → DB → Realtime is the canonical path; direct Worker → client streaming is explicitly avoided.

## Consequences
### Positive
- Events survive UI disconnections: when the browser reconnects, it queries the DB for events since its last seen ID and resumes the live subscription. No event loss.
- Single source of truth — every event the UI displays exists in the database, so audit, replay, and post-hoc analysis are trivial.
- Multiple clients (browser, mobile, CLI) can watch the same run concurrently without the Worker tracking subscribers.
- The Worker stays simple: parse stdout, write to DB. It has no socket-management responsibilities.

### Negative
- Every event incurs a database write, adding latency between Claude emitting a token and the user seeing it. Mitigated by batching low-priority events (e.g. content deltas) and writing high-priority lifecycle events immediately.
- Hard dependency on Supabase Realtime — if Realtime is degraded, live updates stall (history is still recorded in Postgres).
- Higher Postgres write volume than a pure in-memory pubsub would have. Requires monitoring write throughput and tuning the batch window.

### Neutral / Risks
- The shape of stream-json events is owned by Anthropic; if they change it, our parser must follow. We isolate parsing in a single module to contain blast radius.
- Realtime fan-out cost scales with concurrent viewers; for typical single-user runs this is negligible.
- The SSE proxy endpoint becomes a long-lived connection; we must size the Next.js runtime accordingly (Edge or Node with appropriate timeouts).

## Alternatives Considered
### Alternative 1: Polling the database from the UI
**Description:** Have the browser poll `/api/runs/[id]/events?since=...` every N seconds.
**Rejected because:** Polling at the cadence required to feel "live" (sub-second) generates significant load and still feels laggy. Polling slower feels broken. Realtime gives us push semantics for free — there is no upside to polling here.

### Alternative 2: Custom WebSocket server
**Description:** Stand up a dedicated WebSocket service (e.g. on a separate Node process or via Pusher/Ably) that the Worker pushes to and the UI subscribes to.
**Rejected because:** Supabase Realtime is already a required dependency and solves the same problem with less code, less infrastructure, and better integration with our auth and RLS model. Adding a parallel pubsub system would duplicate functionality without benefit.

### Alternative 3: Direct SSE from Worker to UI
**Description:** Have the Worker expose an HTTP endpoint that streams events via SSE directly to the browser, bypassing the database.
**Rejected because:** It does not survive disconnections — when the browser drops, in-flight events are lost and there is no replay mechanism. It also tightly couples UI availability to Worker reachability (NAT, firewalls, multi-replica scaling). Supabase Realtime acts as a durable event bus that decouples these concerns.

## Open Questions
- What is the right batch window for content-delta events (5ms? 50ms?) to balance perceived latency against write volume? Needs measurement under real workloads.
- Should the SSE proxy endpoint be Edge runtime (lower latency, harder DB access) or Node runtime (simpler, more capable)? Lean Node initially, revisit if latency is an issue.

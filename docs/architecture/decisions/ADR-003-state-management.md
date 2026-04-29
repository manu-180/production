# ADR-003: Supabase Postgres as Single Source of Truth

## Status
Accepted

## Date
2026-04-29

## Context
Conductor has three components that must share state: the Worker (which spawns and supervises Claude CLI processes), the Next.js API routes (which serve the dashboard and accept user actions like start/cancel/retry), and the React UI (which renders run progress live). State includes run lifecycle (queued, running, completed, failed), per-prompt execution status, streamed events, Guardian decisions, checkpoint SHAs, and metrics.

This state must be durable (a Worker crash mid-run cannot lose the fact that prompt 7 of 12 finished successfully), queryable (the dashboard shows historical runs), real-time observable (the UI updates as the Worker writes), and shareable across replicas (in the future we may run multiple Workers). The product is a Next.js + Supabase application, so Postgres is already provisioned, already authenticated, and already wired into Realtime — adding a second state store would be redundant infrastructure.

The decision is whether to centralize state in the database or split it across in-memory stores, queues, and caches. Splitting introduces consistency problems and crash-recovery complexity; centralizing trades raw latency for operational simplicity.

## Decision
Supabase Postgres is the single source of truth for all Conductor state. The Worker writes every state transition (run status changes, prompt execution status, individual events, Guardian decisions, checkpoint SHAs) directly to Postgres. The UI reads through React Query for caching and Supabase Realtime for live invalidation. There is no in-memory state store on the Worker, no Redis, no separate job queue with its own state.

Concurrency is managed via Postgres row locks and advisory locks where needed (e.g. claiming a queued run for execution). The Worker holds no authoritative state of its own — if it crashes, a fresh Worker can pick up where the previous one left off by reading the database.

## Consequences
### Positive
- Full crash recovery: a Worker can die mid-run and a replacement Worker reconstructs the run state from Postgres. No state lives only in memory.
- Multi-device, multi-tab UI works for free — every client reads the same source of truth.
- Audit and debugging are trivial; every state transition is a row you can query.
- One fewer infrastructure component to operate, monitor, and secure.
- React Query handles client-side staleness and request deduplication; no custom sync layer needed.

### Negative
- Every event is a database write, adding latency compared to pure in-memory state. Acceptable for our event rates; mitigated by batching where appropriate (see ADR-002).
- Postgres becomes a hard dependency for the Worker; without it, no progress can be made. There is no graceful-degradation mode.
- Schema changes require migrations coordinated across Worker and UI deployments.

### Neutral / Risks
- Write amplification on long runs with many events is a real cost; we monitor table growth and partition or archive as needed.
- We rely on Supabase RLS for tenant isolation — getting policies wrong is a security risk that must be tested.
- Eventually a Redis or queue layer might be justified for very high-throughput scenarios, but YAGNI applies until we measure pain.

## Alternatives Considered
### Alternative 1: In-memory state in the Worker
**Description:** Hold run state in the Worker's process memory and only flush to Postgres at coarse milestones (e.g. after each prompt completes).
**Rejected because:** A crash between flushes loses progress and event history. The UI cannot observe live state without an additional sync mechanism. Resumability across Worker restarts becomes fragile — the very thing checkpoints (ADR-005) and Guardian (ADR-004) need to be reliable.

### Alternative 2: Redis as a state store / cache layer
**Description:** Put hot state (current run cursor, in-flight events) in Redis and async-replicate to Postgres for durability.
**Rejected because:** Redis is extra infrastructure with no benefit Conductor cannot get from Postgres + Realtime. We would be paying operational cost (deployment, monitoring, failover) for a performance optimization we have not yet measured a need for. Premature.

### Alternative 3: File-based state (JSON on disk)
**Description:** Persist run state as JSON files in a working directory, one per run.
**Rejected because:** It does not support multiple concurrent Workers, makes real-time UI impossible without inotify-style hacks, and offers no transactional guarantees. Backup, replication, and audit all become bespoke. The database solves all of this out of the box.

## Open Questions
- At what event volume does it make sense to introduce a partitioning strategy on the `events` table (per-day? per-run?)? Defer until we have production data.
- Should completed runs older than N days be archived to cold storage to keep the hot tables small? Likely yes, threshold TBD.

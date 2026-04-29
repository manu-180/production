# Conductor

> Plan it once. Conduct it forever.

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](#)
[![License](https://img.shields.io/badge/license-MIT-blue)](#)
[![Version](https://img.shields.io/badge/version-0.1.0-orange)](#)

Conductor is an AI plan orchestration tool. Define a sequence of prompts once in Markdown, then let Conductor execute them reliably — with git checkpoints, automatic retries, a Guardian agent for ambiguous decisions, and live streaming to a real-time dashboard.

---

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env and fill in your Supabase + Anthropic credentials
cp .env.example .env

# 3. Start the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to see the dashboard.

---

## Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Web UI      | Next.js 16, React 19, Tailwind 4    |
| Components  | shadcn/ui, Radix, framer-motion     |
| Worker      | Node.js, tsx, pino                  |
| Database    | Supabase (Postgres + Realtime)      |
| Shared      | `@conductor/core`, `@conductor/db`  |
| Tooling     | Turborepo, pnpm workspaces          |
| Quality     | Biome (lint + format), lefthook     |
| Language    | TypeScript 5 (strict)               |

---

## Monorepo Structure

```
conductor/
├── apps/
│   ├── web/        # Next.js dashboard
│   └── worker/     # Plan executor process
├── packages/
│   ├── core/       # Shared types, Result<T,E>, logger
│   └── db/         # Supabase client (typed)
└── docs/           # Architecture docs + ADRs
```

---

## Commands

```bash
pnpm dev          # Start all apps in watch mode
pnpm build        # Production build (all apps)
pnpm typecheck    # TypeScript check (all packages)
pnpm lint         # Biome lint check
pnpm lint:fix     # Biome lint + auto-fix
pnpm format       # Biome format (write)
pnpm test         # Run test suites
```

---

## Documentation

Architecture decisions, data flow, and type contracts live in [`docs/`](./docs/).

- [Architecture Overview](./docs/architecture/README.md)
- [Type Contracts](./docs/architecture/contracts.ts)
- [ADR Index](./docs/architecture/decisions/)
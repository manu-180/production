# Getting Started with Conductor

> Plan it once. Conduct it forever.

Conductor is a self-hosted AI prompt orchestration platform. You define a sequence of prompts in Markdown files, point Conductor at a working directory, and it drives Claude through your entire plan — with live streaming, automatic checkpoints, a Guardian agent for ambiguous decisions, and full crash recovery.

This guide walks you from zero to your first completed run in under 15 minutes.

---

## Prerequisites

Before installing Conductor, make sure you have the following tools available.

| Tool | Minimum Version | Install |
|---|---|---|
| Node.js | 20.x LTS | [nodejs.org](https://nodejs.org) |
| pnpm | 10.x | `npm install -g pnpm@latest` |
| Docker Desktop | Latest stable | [docker.com](https://docker.com) |
| Claude CLI | Latest | See below |
| Git | 2.x | [git-scm.com](https://git-scm.com) |

### Installing the Claude CLI

Conductor uses your Claude Max subscription (OAuth token) — not a Console API key. The Claude CLI must be installed and authenticated.

```bash
# Install the Claude CLI globally
npm install -g @anthropic-ai/claude-cli

# Authenticate with your subscription token
claude setup-token

# Verify
claude --version
```

> **Important:** Conductor requires a Claude Max subscription ($100/mo or $200/mo). It drives the `claude` CLI as a subprocess, which is what makes it economical — you pay your flat subscription rate, not per-token Console API costs.

---

## Installation Paths

Choose the path that fits your use case.

---

### Path 1 — Local Development

Use this when you want to modify Conductor itself or explore the codebase. Runs everything in watch mode with hot-reload.

```bash
# 1. Clone the repository
git clone https://github.com/your-org/conductor.git
cd conductor

# 2. Run the automated setup (installs deps, copies .env, seeds demo data)
./scripts/setup.sh --demo

# 3. Start all services in development mode
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

The `--demo` flag seeds the database with a sample "Hello Conductor" plan so you can explore the UI without configuring anything. Skip it if you want a blank slate.

**What `setup.sh` does:**
- Checks that Node 20+, pnpm, Docker, and the Supabase CLI are present
- Copies `.env.example` to `.env`
- Generates a random `CONDUCTOR_ENCRYPTION_KEY` for you
- Runs `pnpm install`
- Starts Supabase locally (`supabase start`) and applies all migrations
- If `--demo` is passed, runs `scripts/seed-demo.ts`

**Monorepo dev processes started by `pnpm dev`:**
- `apps/web` — Next.js dev server on port 3000
- `apps/worker` — Node.js worker process (tsx watch)
- Supabase local stack (Postgres + Realtime) must already be running

---

### Path 2 — Docker Compose (Self-Hosted)

Use this for a persistent production-like deployment on your own server. Everything runs in containers; no local Node.js or pnpm required at runtime.

```bash
# 1. Clone the repository
git clone https://github.com/your-org/conductor.git
cd conductor

# 2. Copy and configure the environment file
cp .env.example .env
# Open .env in your editor and fill in the required values (see below)

# 3. Start all services
docker compose up -d

# 4. Check that everything is healthy
docker compose ps
```

Open [http://localhost:3000](http://localhost:3000).

**Minimum `.env` values required for Docker Compose:**

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
CONDUCTOR_ENCRYPTION_KEY=<32-byte hex — generate with: openssl rand -hex 32>
```

See [`docs/reference/env-vars.md`](./reference/env-vars.md) for the full variable reference.

**Services started by `docker compose up`:**
- `conductor-web` — Next.js web application (port 3000)
- `conductor-worker` — Node.js worker process
- `conductor-db` — PostgreSQL (Supabase-compatible, port 5432)

The worker container mounts two volumes:
- `${HOST_WORKING_DIRS_ROOT:-./working_dirs}` — where Claude operates on your code
- `claude_config` — persists the Claude CLI authentication across container restarts

For a complete self-hosting guide including reverse proxy configuration, updates, and security hardening, see [`docs/how-to/self-host.md`](./how-to/self-host.md).

---

### Path 3 — Hosted (Coming Soon)

A fully managed hosted version is planned for a future release. You will be able to sign up, connect your Claude token, and start creating plans without any infrastructure setup.

---

## First Run Guide

Once Conductor is running at `http://localhost:3000`, follow these steps to complete onboarding and launch your first run.

### Step 1: Complete the Onboarding Wizard

The first time you open Conductor, you are redirected to the onboarding wizard at `/onboarding`. It has three steps:

1. **Claude Token** — Paste your Claude OAuth token. Conductor encrypts it at rest with AES-256-GCM using your `CONDUCTOR_ENCRYPTION_KEY`. The token is never exposed to the browser after this step.

2. **Working Directory** — Enter the absolute path to the Git repository where you want Claude to make changes (e.g. `/home/you/myproject`). This directory must be an initialized Git repository (`git init` if it is not).

3. **Done** — Conductor verifies that the Claude CLI is accessible and that your working directory is a valid Git repo.

> **The working directory must be a Git repository.** Conductor creates Git commits (checkpoints) after each successful prompt. If your target directory is not a Git repo, run `cd /your/target/dir && git init && git add -A && git commit -m "initial"` before proceeding.

---

### Step 2: Create Your First Plan

A **Plan** is a collection of ordered prompt files. Each file is a Markdown document with YAML frontmatter metadata at the top and the prompt text in the body.

**Option A — Upload your own prompts:**

1. Navigate to **Plans** → **New Plan**
2. Drag and drop a folder of `.md` prompt files onto the upload zone
3. Conductor validates each file's frontmatter and auto-assigns ordering
4. Click **Save Plan**

**Option B — Use the Hello Conductor demo:**

If you ran `setup.sh --demo` or seeded the database, a pre-built demo plan is already available. Go to **Plans** and select "Hello Conductor". It contains three simple prompts that create a README file, add a basic test, and document the result.

For a complete guide on writing prompt files, see [`docs/how-to/write-prompts.md`](./how-to/write-prompts.md).

---

### Step 3: Launch a Run

1. Open a Plan and click **Run Plan**
2. Confirm the working directory (you can override per-run)
3. Click **Start Run**

The Run Viewer opens automatically. You will see:

- **Live token stream** — Claude's output appears in real time as it generates, token by token
- **Step progress** — each prompt shows its current state: queued, running, succeeded, or failed
- **Guardian panel** — if Claude asks an ambiguous question, the Guardian intercepts it and either auto-answers or surfaces it to you for approval
- **Checkpoint log** — as each prompt completes, a Git commit is recorded and shown in the timeline

The run executes all prompts sequentially. You do not need to stay on the page — the run continues in the background and you can return to check progress at any time.

---

### Step 4: Explore Guardian and Checkpoints

**Guardian decisions** appear in the right panel of the Run Viewer. Each decision shows:
- The question Claude asked
- Which strategy resolved it (rule-based, default, or LLM)
- The answer provided and the reasoning
- A confidence score

If a decision requires human review (confidence below 0.7), the run pauses and you receive a notification. Click **Approve** or **Deny** in the Guardian panel to resume.

**Checkpoints** appear in the commit timeline below the stream. Click any checkpoint to see the diff of what Claude changed in that step. If something went wrong, use the **Rollback** button to restore the working directory to any previous checkpoint state.

---

## What Happens Next

Once you have completed your first run, explore the rest of Conductor:

- **Insights** (`/dashboard/insights`) — KPI analytics, Guardian decision trends, cost tracking, and prompt performance leaderboard
- **Plan Editor** (`/dashboard/plans/[id]`) — Edit prompt frontmatter, reorder steps, and validate YAML in a split-pane editor
- **Schedules** (`/dashboard/settings`) — Run a plan on a cron schedule
- **Webhooks** (`/dashboard/integrations`) — Send run completion notifications to Slack or any HTTP endpoint

---

## Quick Reference

```bash
# Local dev
pnpm dev                          # Start all services
pnpm typecheck                    # TypeScript check
pnpm lint                         # Biome lint
pnpm test                         # Run all tests

# Docker
docker compose up -d              # Start all containers
docker compose ps                 # Check health
docker compose logs -f worker     # Stream worker logs
docker compose restart worker     # Restart worker only

# Supabase (local dev)
supabase start                    # Start local Supabase
supabase db reset                 # Reset + re-apply migrations
supabase status                   # Show local URLs and keys
```

---

## Next Steps

- [Writing Prompts](./how-to/write-prompts.md) — Deep guide on prompt frontmatter and best practices
- [Configuring Guardian](./how-to/configure-guardian.md) — Tune auto-decision behavior
- [Self-Hosting](./how-to/self-host.md) — Production deployment with nginx and HTTPS
- [Environment Variables](./reference/env-vars.md) — Complete variable reference
- [Troubleshooting](./troubleshooting.md) — Common issues and fixes
- [FAQ](./faq.md) — Frequently asked questions

# Environment Variable Reference

This document describes every environment variable recognized by Conductor. Copy `.env.example` to `.env` and fill in the values marked **Required** before starting the application.

Generate a fresh encryption key for each new deployment:
```bash
openssl rand -hex 32
```

---

## Variable Reference

### Supabase

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Required | — | Your Supabase project URL. For Supabase Cloud: `https://<project-ref>.supabase.co`. For self-hosted: the public URL of your Supabase stack (e.g. `http://your-server:8000`). The `NEXT_PUBLIC_` prefix makes this available in browser-side Next.js code. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required | — | Supabase anonymous (public) key. Safe to expose in the browser. Used for all client-side database operations subject to Row Level Security policies. Found in your Supabase project under Settings → API. |
| `SUPABASE_SERVICE_ROLE_KEY` | Required | — | Supabase service role key. **Server-side only.** This key bypasses all RLS policies. Used by API routes and the worker process for privileged operations. Never set this in a `NEXT_PUBLIC_*` variable. Never log it. Found in Supabase project under Settings → API. |

**Example:**
```env
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

### Conductor Core

| Variable | Required | Default | Description |
|---|---|---|---|
| `CONDUCTOR_ENCRYPTION_KEY` | Required | — | 32-byte (64-character) hex string used as the AES-256-GCM encryption key for Claude OAuth tokens at rest. Generate with `openssl rand -hex 32`. Must be exactly 64 hex characters. If this key changes, all stored tokens become unreadable and users must re-enter them. Back this up securely. |
| `CONDUCTOR_DEFAULT_MODEL` | Optional | `claude-sonnet-4-7` | The default Claude model identifier used when creating new runs. Individual plans can override this. Valid values are any model identifier supported by your Claude CLI version (e.g. `claude-opus-4-5`, `claude-sonnet-4-7`, `claude-haiku-4-5`). |

**Example:**
```env
CONDUCTOR_ENCRYPTION_KEY=a3f8c2e1d4b7a9e6f2c5d8b1a4e7f0c3d6b9a2e5f8c1d4b7a0e3f6c9d2b5a8e1
CONDUCTOR_DEFAULT_MODEL=claude-sonnet-4-7
```

---

### Logging

| Variable | Required | Default | Description |
|---|---|---|---|
| `LOG_LEVEL` | Optional | `info` | Minimum log level for the Pino logger used by the worker and API. Valid values: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. Use `debug` during development to see execution details. Use `warn` or `error` in production to reduce log volume. |

**Example:**
```env
LOG_LEVEL=debug    # Development
LOG_LEVEL=warn     # Production
```

---

### Application

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | Optional | `development` | Node.js environment mode. Valid values: `development`, `production`, `test`. In `production` mode, Next.js enables output optimization, disables hot-reload, and activates performance-focused defaults. Set to `production` in all Docker deployments. |

**Example:**
```env
NODE_ENV=production
```

---

### Docker Compose Additional Variables

These variables are used by `docker-compose.yml` but are not consumed by the application code directly.

| Variable | Required | Default | Description |
|---|---|---|---|
| `HOST_WORKING_DIRS_ROOT` | Optional | `./working_dirs` | Host path mounted into the worker container at `/working_dirs`. Set this to the directory on your host that contains the Git repositories you want Claude to operate on. Example: `/home/user/projects`. |
| `POSTGRES_PASSWORD` | Optional | `postgres` | Password for the bundled PostgreSQL container (`conductor-db`). Only relevant if using the Docker Compose bundled database instead of Supabase Cloud. Change from the default in any non-local deployment. |

**Example:**
```env
HOST_WORKING_DIRS_ROOT=/home/user/codebases
POSTGRES_PASSWORD=a_secure_random_password
```

---

## Complete `.env.example`

The file below is the canonical `.env.example` included with the repository. Copy it to `.env` and fill in your values.

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Conductor
CONDUCTOR_ENCRYPTION_KEY=        # 32 bytes hex — generate: openssl rand -hex 32
CONDUCTOR_DEFAULT_MODEL=claude-sonnet-4-7

# Logging
LOG_LEVEL=info

# App
NODE_ENV=development
```

---

## Security Notes

**`SUPABASE_SERVICE_ROLE_KEY`** — This is the most sensitive value in your configuration. It grants full unrestricted access to your Supabase database, bypassing all Row Level Security policies. Treat it like a root database password. Rotation requires updating the value in your Supabase project settings and then in your `.env`.

**`CONDUCTOR_ENCRYPTION_KEY`** — This key protects your Claude OAuth tokens. If the key is compromised, an attacker with database access could decrypt stored tokens. Rotate it by:
1. Generating a new key: `openssl rand -hex 32`
2. Updating `.env` with the new key
3. Re-entering all Claude tokens in Settings (old tokens will be unreadable)

**`.env` file permissions** — On Linux, restrict `.env` permissions to the application user:
```bash
chmod 600 /opt/conductor/.env
chown conductor:conductor /opt/conductor/.env
```

---

## Related Documentation

- [Self-Hosting Guide](../how-to/self-host.md) — Full deployment walkthrough
- [Getting Started](../getting-started.md) — Initial setup and first run

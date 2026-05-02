# How to Self-Host Conductor

This guide covers deploying Conductor on your own server using Docker Compose. The result is a persistent, production-grade deployment that you control entirely — no third-party hosting required beyond your choice of Supabase (cloud or self-hosted).

---

## Requirements

| Resource | Minimum | Recommended |
|---|---|---|
| RAM | 2 GB | 4 GB |
| CPU | 1 vCPU | 2 vCPU |
| Disk | 10 GB | 40 GB |
| OS | Linux (Ubuntu 22.04+, Debian 12+) | Ubuntu 22.04 LTS |
| Docker | 24.x | Latest stable |
| Docker Compose | v2.x (plugin) | Latest stable |

The worker container mounts a volume for Claude's working directories. If you expect large codebases, allocate disk accordingly.

---

## Architecture of a Self-Hosted Deployment

```
Internet
    |
    v
Nginx (port 80/443)
    |
    v
conductor-web (port 3000)   conductor-worker
        \                       /
         \                     /
          v                   v
         Supabase (Postgres + Realtime)
              |
              v
         conductor-db (port 5432) [if self-hosted Supabase]
```

The web and worker services do not communicate directly — they coordinate entirely through Supabase Realtime and Postgres. This means you can restart either service independently without affecting the other.

---

## Step 1: Prepare the Server

```bash
# Update system packages
apt-get update && apt-get upgrade -y

# Install Docker (official install script)
curl -fsSL https://get.docker.com | sh

# Add your user to the docker group
usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

---

## Step 2: Clone the Repository

```bash
git clone https://github.com/your-org/conductor.git /opt/conductor
cd /opt/conductor
```

---

## Step 3: Configure the Environment

```bash
cp .env.example .env
```

Open `.env` in your editor and fill in the required values. At minimum:

```env
# Supabase — required
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Encryption key — required, generate fresh for each deployment
CONDUCTOR_ENCRYPTION_KEY=<output of: openssl rand -hex 32>

# Optional
CONDUCTOR_DEFAULT_MODEL=claude-sonnet-4-7
LOG_LEVEL=info
NODE_ENV=production
```

Generate a fresh encryption key:
```bash
openssl rand -hex 32
```

> **Security:** The `CONDUCTOR_ENCRYPTION_KEY` encrypts Claude OAuth tokens at rest. Never reuse keys across environments. Never commit `.env` to version control.

See [`docs/reference/env-vars.md`](../reference/env-vars.md) for the complete variable reference.

---

## Step 4: Configure the Worker Volume

The worker container needs access to the directories where Claude will operate. By default, it mounts `./working_dirs` relative to the project root:

```bash
mkdir -p /opt/conductor/working_dirs
```

If your codebases live in a different location (e.g. `/home/user/projects`), set `HOST_WORKING_DIRS_ROOT` in `.env`:

```env
HOST_WORKING_DIRS_ROOT=/home/user/projects
```

The worker mounts this path at `/working_dirs` inside the container. When you configure a working directory in Conductor's onboarding wizard, use the path as it appears inside the container (e.g. `/working_dirs/myproject`).

---

## Step 5: Start the Services

```bash
cd /opt/conductor
docker compose up -d
```

This starts three containers:

- `conductor-web` — Next.js application on port 3000
- `conductor-worker` — Node.js worker process
- `conductor-db` — PostgreSQL (only if using the bundled database; omit if using Supabase Cloud)

Check that all containers are healthy:
```bash
docker compose ps
```

Expected output:
```
NAME                 STATUS                  PORTS
conductor-web        Up 30 seconds (healthy) 0.0.0.0:3000->3000/tcp
conductor-worker     Up 30 seconds (healthy)
conductor-db         Up 45 seconds (healthy) 0.0.0.0:5432->5432/tcp
```

Check logs:
```bash
docker compose logs -f          # All services
docker compose logs -f worker   # Worker only
docker compose logs -f web      # Web only
```

---

## Step 6: Configure Nginx as a Reverse Proxy

For production use, place Nginx in front of Conductor. Nginx provides TLS termination, HTTP/2, request buffering, and a stable public-facing port.

The Docker Compose file includes a commented-out `nginx` service. Alternatively, use a system-level Nginx:

```bash
apt-get install -y nginx certbot python3-certbot-nginx
```

Create `/etc/nginx/sites-available/conductor`:

```nginx
server {
    listen 80;
    server_name conductor.yourdomain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name conductor.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/conductor.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/conductor.yourdomain.com/privkey.pem;

    # SSE / long-poll support
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site and obtain a certificate:
```bash
ln -s /etc/nginx/sites-available/conductor /etc/nginx/sites-enabled/
certbot --nginx -d conductor.yourdomain.com
nginx -t && systemctl reload nginx
```

> **SSE requirement:** Conductor uses Server-Sent Events for real-time streaming. The `proxy_read_timeout 3600s` and `proxy_buffering off` settings are mandatory — without them, SSE streams will be cut off by Nginx's default 60-second timeout.

---

## Supabase Options

### Option A: Supabase Cloud (Recommended)

Sign up at [supabase.com](https://supabase.com), create a new project, and copy the project URL and keys into your `.env`. Supabase Cloud handles scaling, backups, and updates. The free tier is sufficient for a single-user Conductor deployment.

In your `.env`, comment out or remove the `supabase-db` section from the Docker Compose file — you do not need the bundled database.

### Option B: Self-Hosted Supabase

For full data sovereignty, run Supabase yourself. The bundled `conductor-db` PostgreSQL service is a lightweight alternative, but it does not include Supabase's REST API, Realtime server, or Auth service. For a complete Supabase self-hosted stack:

```bash
# Clone the Supabase Docker repo
git clone --depth 1 https://github.com/supabase/supabase /opt/supabase
cd /opt/supabase/docker
cp .env.example .env
# Fill in .env, especially JWT_SECRET and ANON_KEY
docker compose up -d
```

Then point Conductor's `NEXT_PUBLIC_SUPABASE_URL` to your self-hosted Supabase instance (e.g. `http://your-server-ip:8000`).

---

## Updating Conductor

```bash
cd /opt/conductor

# Pull latest code
git pull

# Rebuild and restart containers
docker compose up -d --build

# Verify all containers are healthy
docker compose ps
```

Database migrations are applied automatically on container startup via the Supabase migration runner.

---

## Security Checklist

Before opening Conductor to the internet, review and complete this checklist.

- [ ] **Generate a fresh `CONDUCTOR_ENCRYPTION_KEY`** — Never reuse the example or development key in production. Run `openssl rand -hex 32`.

- [ ] **Enable HTTPS** — Configure Nginx with Let's Encrypt or your own certificate. Never expose Conductor over plain HTTP on a public network.

- [ ] **Restrict the `SUPABASE_SERVICE_ROLE_KEY`** — This key bypasses all Row Level Security policies. It must only be used server-side (the Next.js API layer). Confirm it is never set in `NEXT_PUBLIC_*` variables and never appears in browser network traffic.

- [ ] **Secure the PostgreSQL port** — If using the bundled `conductor-db`, the default compose configuration exposes port 5432 on all interfaces. In production, remove the `ports` mapping from `supabase-db` in `docker-compose.yml` and let Conductor connect over the Docker internal network.

- [ ] **Restrict worker network access** — The worker container only needs to reach Supabase and the Anthropic API. Consider adding network firewall rules or Docker network policies to prevent the worker from accessing other internal services.

- [ ] **Enable Docker log rotation** — Conductor generates structured JSON logs. Without rotation, log files can fill your disk:
  ```json
  {
    "log-driver": "json-file",
    "log-opts": {
      "max-size": "100m",
      "max-file": "5"
    }
  }
  ```
  Add to `/etc/docker/daemon.json` and restart Docker.

- [ ] **Keep Git and Docker updated** — Run `apt-get upgrade` regularly.

- [ ] **Back up your `.env` securely** — If you lose the `CONDUCTOR_ENCRYPTION_KEY`, all stored Claude tokens become unreadable and users must re-enter them.

---

## Backup and Restore

Use the included backup script for full backups:

```bash
cd /opt/conductor
bash scripts/backup.sh
```

The backup script exports:
- Postgres database dump
- `.env` configuration (encrypted)
- Working directories snapshot (optional, controlled by a flag)

Backups are placed in `./backups/` with a timestamp. Store them off-machine (S3, Backblaze, rsync to another server).

**Restore from backup:**
```bash
# Restore database
docker exec -i conductor-db psql -U postgres postgres < backups/2026-05-01/postgres.sql

# Restore env
cp backups/2026-05-01/.env.enc .env.enc
# Decrypt with your key, then:
cp decrypted.env .env
docker compose up -d
```

---

## Monitoring and Health Checks

Conductor exposes a health endpoint:

```bash
curl http://localhost:3000/api/system/health
```

Response:
```json
{
  "status": "ok",
  "worker": "online",
  "db": "connected",
  "uptime": 3600
}
```

The `worker` field reflects whether the worker's last heartbeat was within the threshold. Use this endpoint with your monitoring system (Uptime Kuma, Better Uptime, etc.).

The `scripts/healthcheck.sh` script wraps this endpoint for Docker health check use:
```bash
bash scripts/healthcheck.sh
# Exit 0 = healthy, exit 1 = unhealthy
```

---

## Related Documentation

- [Environment Variables](../reference/env-vars.md) — Complete `.env` reference
- [Getting Started](../getting-started.md) — First run walkthrough
- [Troubleshooting](../troubleshooting.md) — Common deployment issues

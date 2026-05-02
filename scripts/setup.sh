#!/usr/bin/env bash
# setup.sh — One-shot environment setup for Conductor.
#
# Usage:
#   ./scripts/setup.sh [--demo]
#
#   --demo    After setup, run the demo seed script.
#
# Requirements: bash >= 4.4, node >= 20, pnpm, docker, supabase CLI.
# Note: run `chmod +x scripts/setup.sh` on Linux/macOS before first use.

set -Eeuo pipefail
shopt -s inherit_errexit

# ─── constants ────────────────────────────────────────────────────────────────

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
readonly ENV_FILE="${ROOT_DIR}/.env"
readonly ENV_EXAMPLE="${ROOT_DIR}/.env.example"

readonly MIN_NODE_MAJOR=20

# ─── helpers ──────────────────────────────────────────────────────────────────

log_info()  { printf '[INFO]  %s\n' "$*" >&2; }
log_ok()    { printf '[OK]    %s\n' "$*" >&2; }
log_warn()  { printf '[WARN]  %s\n' "$*" >&2; }
log_error() { printf '[ERROR] %s\n' "$*" >&2; }

die() {
  log_error "$*"
  exit 1
}

# ─── argument parsing ─────────────────────────────────────────────────────────

RUN_DEMO=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --demo) RUN_DEMO=true ;;
    --help|-h)
      printf 'Usage: %s [--demo]\n\n  --demo  Seed demo data after setup.\n' \
        "$(basename -- "$0")"
      exit 0
      ;;
    *)
      die "Unknown option: $1  (try --help)"
      ;;
  esac
  shift
done

# ─── prerequisite checks ──────────────────────────────────────────────────────

check_prereqs() {
  log_info "Checking prerequisites..."

  # node
  if ! command -v node &>/dev/null; then
    die "node is not installed. Download from https://nodejs.org (>= ${MIN_NODE_MAJOR})"
  fi
  local node_major
  node_major="$(node --version | sed 's/^v//' | cut -d. -f1)"
  if (( node_major < MIN_NODE_MAJOR )); then
    die "node ${node_major} found; need >= ${MIN_NODE_MAJOR}. Update at https://nodejs.org"
  fi
  log_ok "node $(node --version)"

  # pnpm
  if ! command -v pnpm &>/dev/null; then
    die "pnpm is not installed. Run: npm install -g pnpm"
  fi
  log_ok "pnpm $(pnpm --version)"

  # docker
  if ! command -v docker &>/dev/null; then
    die "docker is not installed. Download from https://docs.docker.com/get-docker/"
  fi
  if ! docker info &>/dev/null; then
    die "Docker daemon is not running. Start Docker Desktop (or the daemon) and retry."
  fi
  log_ok "docker $(docker --version | cut -d' ' -f3 | tr -d ',')"

  # supabase CLI (optional path: available as pnpm dlx supabase)
  if ! command -v supabase &>/dev/null && ! pnpm dlx supabase --version &>/dev/null 2>&1; then
    log_warn "supabase CLI not found globally — will use 'pnpm dlx supabase' as fallback."
  else
    log_ok "supabase CLI available"
  fi
}

# ─── .env bootstrap ───────────────────────────────────────────────────────────

bootstrap_env() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    if [[ ! -f "${ENV_EXAMPLE}" ]]; then
      die ".env.example not found at ${ENV_EXAMPLE}. Cannot bootstrap .env."
    fi
    log_info "Creating .env from .env.example..."
    cp -- "${ENV_EXAMPLE}" "${ENV_FILE}"
    log_ok ".env created"
  else
    log_info ".env already exists — skipping copy."
  fi

  # Generate CONDUCTOR_ENCRYPTION_KEY if blank/missing.
  # Read current value (handle file that may lack a trailing newline).
  local current_key=""
  if grep -q '^CONDUCTOR_ENCRYPTION_KEY=' "${ENV_FILE}"; then
    current_key="$(grep '^CONDUCTOR_ENCRYPTION_KEY=' "${ENV_FILE}" | head -1 | cut -d= -f2-)"
  fi

  if [[ -z "${current_key}" ]]; then
    log_info "Generating CONDUCTOR_ENCRYPTION_KEY with openssl..."
    local new_key
    new_key="$(openssl rand -hex 32)"

    if grep -q '^CONDUCTOR_ENCRYPTION_KEY=' "${ENV_FILE}"; then
      # Replace existing blank line (portable sed: use temp file)
      local tmp_env
      tmp_env="$(mktemp)"
      sed "s|^CONDUCTOR_ENCRYPTION_KEY=.*|CONDUCTOR_ENCRYPTION_KEY=${new_key}|" \
        "${ENV_FILE}" > "${tmp_env}"
      mv -- "${tmp_env}" "${ENV_FILE}"
    else
      printf '\nCONDUCTOR_ENCRYPTION_KEY=%s\n' "${new_key}" >> "${ENV_FILE}"
    fi
    log_ok "CONDUCTOR_ENCRYPTION_KEY generated and written to .env"
  else
    log_info "CONDUCTOR_ENCRYPTION_KEY already set — skipping generation."
  fi
}

# ─── install dependencies ─────────────────────────────────────────────────────

install_deps() {
  log_info "Installing dependencies with pnpm..."
  pnpm install --frozen-lockfile
  log_ok "Dependencies installed"
}

# ─── start supabase local DB ──────────────────────────────────────────────────

start_db() {
  log_info "Starting supabase-db via docker compose..."
  docker compose --file "${ROOT_DIR}/docker-compose.yml" up -d supabase-db
  log_ok "supabase-db container started (or already running)"

  # Brief wait for Postgres to be ready.
  log_info "Waiting for Postgres to accept connections (up to 30s)..."
  local attempts=0
  until docker compose --file "${ROOT_DIR}/docker-compose.yml" \
        exec -T supabase-db pg_isready -U postgres &>/dev/null \
        || (( attempts >= 30 )); do
    sleep 1
    (( attempts++ )) || true
  done

  if ! docker compose --file "${ROOT_DIR}/docker-compose.yml" \
       exec -T supabase-db pg_isready -U postgres &>/dev/null; then
    die "Postgres did not become ready within 30 seconds."
  fi
  log_ok "Postgres is ready"
}

# ─── run migrations ───────────────────────────────────────────────────────────

run_migrations() {
  log_info "Running database migrations (pnpm db:reset)..."
  pnpm --dir "${ROOT_DIR}" db:reset
  log_ok "Migrations applied"
}

# ─── optional demo seed ───────────────────────────────────────────────────────

run_demo_seed() {
  log_info "Running demo seed (pnpm tsx scripts/seed-demo.ts)..."
  pnpm --dir "${ROOT_DIR}" tsx "${ROOT_DIR}/scripts/seed-demo.ts"
  log_ok "Demo seed complete"
}

# ─── main ─────────────────────────────────────────────────────────────────────

main() {
  log_info "=== Conductor setup ==="

  check_prereqs
  bootstrap_env
  install_deps
  start_db
  run_migrations

  if [[ "${RUN_DEMO}" == "true" ]]; then
    run_demo_seed
  fi

  printf '\n'
  log_ok "=== Setup complete ==="
  printf '\n'
  printf '  Next steps:\n'
  printf '    pnpm dev            — start the web app (http://localhost:3000)\n'
  printf '    pnpm tsx scripts/seed-demo.ts  — seed demo data\n'
  printf '    ./scripts/healthcheck.sh       — verify system health\n'
  printf '\n'
}

main "$@"

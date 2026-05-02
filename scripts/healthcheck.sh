#!/usr/bin/env bash
# healthcheck.sh — Verify the health of the Conductor stack.
#
# Checks:
#   1. Web responds HTTP 200 on /api/system/health
#   2. Worker process is running (pgrep conductor-worker or worker_instances table)
#   3. Database responds (docker compose ps or pg_isready)
#   4. Claude CLI is installed and returns a version
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed
#
# Note: run `chmod +x scripts/healthcheck.sh` on Linux/macOS before first use.

set -Eeuo pipefail
shopt -s inherit_errexit

# ─── constants ────────────────────────────────────────────────────────────────

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"

readonly WEB_HEALTH_URL="${BASE_URL:-http://localhost:3000}/api/system/health"
readonly CURL_TIMEOUT=10

# ─── helpers ──────────────────────────────────────────────────────────────────

PASS=0
FAIL=0

check_pass() { printf '  [OK]  %s\n' "$*"; (( PASS++ )) || true; }
check_fail() { printf '  [FAIL] %s\n' "$*" >&2; (( FAIL++ )) || true; }

# ─── check: web /api/system/health ───────────────────────────────────────────

check_web() {
  printf 'Checking web (%s)...\n' "${WEB_HEALTH_URL}"
  local http_status
  http_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --max-time "${CURL_TIMEOUT}" -- "${WEB_HEALTH_URL}" 2>/dev/null || echo "000")"

  if [[ "${http_status}" == "200" ]]; then
    check_pass "Web responded HTTP ${http_status}"
  else
    check_fail "Web returned HTTP ${http_status} (expected 200). Is 'pnpm dev' running?"
  fi
}

# ─── check: worker process ────────────────────────────────────────────────────

check_worker() {
  printf 'Checking worker process...\n'

  # Primary: look for the named process.
  if pgrep -f 'conductor-worker' &>/dev/null 2>&1; then
    check_pass "Worker process found via pgrep"
    return
  fi

  # Secondary: query the health API for worker status (non-blocking).
  local worker_status
  worker_status="$(curl --silent --max-time "${CURL_TIMEOUT}" \
    -- "${WEB_HEALTH_URL}" 2>/dev/null \
    | grep -o '"worker":"[^"]*"' | cut -d'"' -f4 || echo "unknown")"

  case "${worker_status}" in
    ok)
      check_pass "Worker reported 'ok' via health API"
      ;;
    offline)
      check_fail "Worker is OFFLINE (health API says 'offline')"
      ;;
    *)
      check_fail "Worker process not found and health API returned status='${worker_status}'"
      ;;
  esac
}

# ─── check: database ──────────────────────────────────────────────────────────

check_db() {
  printf 'Checking database...\n'

  # Strategy A: ask Postgres directly via docker compose exec.
  if docker compose --file "${ROOT_DIR}/docker-compose.yml" \
       exec -T supabase-db pg_isready -U postgres &>/dev/null 2>&1; then
    check_pass "Database (Postgres) is accepting connections"
    return
  fi

  # Strategy B: inspect docker compose ps for the container status.
  local container_status
  container_status="$(docker compose --file "${ROOT_DIR}/docker-compose.yml" \
    ps --format '{{.Status}}' supabase-db 2>/dev/null || echo "")"

  if [[ "${container_status}" == *"healthy"* ]] \
     || [[ "${container_status}" == *"running"* ]]; then
    check_pass "supabase-db container status: ${container_status}"
  else
    check_fail "Database not reachable. Container status: '${container_status:-not found}'"
  fi
}

# ─── check: claude CLI ────────────────────────────────────────────────────────

check_claude_cli() {
  printf 'Checking Claude CLI...\n'

  if ! command -v claude &>/dev/null; then
    check_fail "claude CLI not found in PATH. Install with: npm install -g @anthropic-ai/claude-code"
    return
  fi

  local version
  version="$(claude --version 2>&1 || echo "")"
  if [[ -n "${version}" ]]; then
    check_pass "claude CLI: ${version}"
  else
    check_fail "claude --version returned empty output"
  fi
}

# ─── main ─────────────────────────────────────────────────────────────────────

main() {
  printf '=== Conductor healthcheck ===\n\n'

  check_web
  check_worker
  check_db
  check_claude_cli

  printf '\n--- Summary ---\n'
  printf '  Passed: %d\n' "${PASS}"
  printf '  Failed: %d\n' "${FAIL}"
  printf '\n'

  if (( FAIL > 0 )); then
    printf 'Health: DEGRADED (%d check(s) failed)\n' "${FAIL}" >&2
    exit 1
  fi

  printf 'Health: OK\n'
  exit 0
}

main "$@"

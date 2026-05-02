#!/usr/bin/env bash
# smoke.sh — Post-deploy smoke test for Conductor.
#
# Flow:
#   1. Create a test plan with a single prompt "echo hello"
#   2. Trigger a run via POST /api/plans/:id/runs
#   3. Poll GET /api/runs/:id every 2s (up to 60s) for status=completed
#   4. Verify final status
#   5. DELETE the test plan (cleanup)
#
# Auth: The API currently operates in single-user dev mode (no token required).
# Set AUTH_TOKEN env var if your deployment requires Bearer auth.
#
# Usage:
#   BASE_URL=https://your-host ./scripts/smoke.sh
#   BASE_URL=http://localhost:3000 ./scripts/smoke.sh
#
# Exit codes:
#   0 — smoke test passed
#   1 — smoke test failed
#
# Note: run `chmod +x scripts/smoke.sh` on Linux/macOS before first use.

set -Eeuo pipefail
shopt -s inherit_errexit

# ─── constants ────────────────────────────────────────────────────────────────

readonly BASE_URL="${BASE_URL:-http://localhost:3000}"
readonly POLL_INTERVAL=2
readonly POLL_TIMEOUT=60
readonly CURL_TIMEOUT=15

# ─── helpers ──────────────────────────────────────────────────────────────────

log_info()  { printf '[smoke] %s\n' "$*" >&2; }
log_ok()    { printf '[smoke] OK — %s\n' "$*" >&2; }
log_error() { printf '[smoke] ERROR — %s\n' "$*" >&2; }

die() {
  log_error "$*"
  exit 1
}

# Build common curl flags. Adds Authorization header only when AUTH_TOKEN is set.
curl_cmd() {
  local args=()
  args+=(--silent --show-error --max-time "${CURL_TIMEOUT}")
  args+=(--header 'Content-Type: application/json')
  if [[ -n "${AUTH_TOKEN:-}" ]]; then
    args+=(--header "Authorization: Bearer ${AUTH_TOKEN}")
  fi
  curl "${args[@]}" "$@"
}

# Extract a JSON string field from a response: json_field <json> <key>
json_field() {
  local json="$1"
  local key="$2"
  # Use grep + sed — no jq required.
  printf '%s' "${json}" \
    | grep -o "\"${key}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
    | head -1 \
    | sed 's/.*"[^"]*"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/'
}

# ─── state ────────────────────────────────────────────────────────────────────

PLAN_ID=""
RUN_ID=""

cleanup() {
  if [[ -n "${PLAN_ID}" ]]; then
    log_info "Cleaning up test plan ${PLAN_ID}..."
    curl_cmd --request DELETE \
      "${BASE_URL}/api/plans/${PLAN_ID}" \
      --output /dev/null || true
    log_info "Test plan deleted."
  fi
}
trap cleanup EXIT

# ─── step 1: create test plan ─────────────────────────────────────────────────

create_plan() {
  log_info "Step 1: Creating test plan..."

  local payload
  payload='{"name":"__smoke-test__","description":"Automated smoke test — safe to delete","prompts":[{"content":"echo hello","title":"Smoke echo","order_index":0}],"tags":["smoke-test"]}'

  local response
  response="$(curl_cmd \
    --request POST \
    --data "${payload}" \
    "${BASE_URL}/api/plans")"

  PLAN_ID="$(json_field "${response}" "id")"

  if [[ -z "${PLAN_ID}" ]]; then
    die "Failed to create plan. Response: ${response}"
  fi

  log_ok "Plan created: ${PLAN_ID}"
}

# ─── step 2: trigger run ──────────────────────────────────────────────────────

trigger_run() {
  log_info "Step 2: Triggering run for plan ${PLAN_ID}..."

  local payload
  payload='{"workingDir":"/tmp/conductor-smoke"}'

  local response
  response="$(curl_cmd \
    --request POST \
    --data "${payload}" \
    "${BASE_URL}/api/plans/${PLAN_ID}/runs")"

  RUN_ID="$(json_field "${response}" "id")"

  if [[ -z "${RUN_ID}" ]]; then
    die "Failed to trigger run. Response: ${response}"
  fi

  log_ok "Run enqueued: ${RUN_ID}"
}

# ─── step 3 + 4: poll until completed or timeout ─────────────────────────────

poll_run() {
  log_info "Step 3: Polling run ${RUN_ID} (${POLL_INTERVAL}s interval, ${POLL_TIMEOUT}s timeout)..."

  local elapsed=0
  local status=""

  while (( elapsed < POLL_TIMEOUT )); do
    local response
    response="$(curl_cmd \
      --request GET \
      "${BASE_URL}/api/runs/${RUN_ID}" 2>/dev/null || echo "")"

    status="$(json_field "${response}" "status")"

    log_info "  elapsed=${elapsed}s status=${status:-unknown}"

    case "${status}" in
      completed)
        log_ok "Run completed in ~${elapsed}s"
        return 0
        ;;
      failed|cancelled)
        die "Run ended with status '${status}' after ${elapsed}s. Response: ${response}"
        ;;
    esac

    sleep "${POLL_INTERVAL}"
    (( elapsed += POLL_INTERVAL )) || true
  done

  die "Run did not complete within ${POLL_TIMEOUT}s. Last status: '${status:-unknown}'"
}

# ─── step 5: verify ───────────────────────────────────────────────────────────

verify_run() {
  log_info "Step 4: Verifying final run status..."

  local response
  response="$(curl_cmd \
    --request GET \
    "${BASE_URL}/api/runs/${RUN_ID}")"

  local final_status
  final_status="$(json_field "${response}" "status")"

  if [[ "${final_status}" != "completed" ]]; then
    die "Final status is '${final_status}', expected 'completed'."
  fi

  log_ok "Final status verified: ${final_status}"
}

# ─── main ─────────────────────────────────────────────────────────────────────

main() {
  printf '=== Conductor smoke test ===\n'
  printf '  Base URL : %s\n\n' "${BASE_URL}"

  create_plan
  trigger_run
  poll_run
  verify_run

  printf '\n'
  log_ok "=== All smoke checks passed ==="
  printf '\n'
}

main "$@"

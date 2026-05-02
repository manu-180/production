#!/usr/bin/env bash
# backup.sh — Backup the Conductor project (DB dump + config structure + docs).
#
# Creates:
#   conductor-backup-<YYYYMMDD-HHMMSS>.tar.gz
#     ├── db/  conductor.sql          — pg_dump from conductor-db container
#     ├── env/ .env.structure         — .env with all values redacted (keys only)
#     ├── migrations/                 — copy of supabase/migrations/
#     └── docs/                       — copy of docs/
#
# The .env values are NEVER included; only the key names are preserved so
# the backup can be used to reconstruct the expected variable set.
#
# Usage:
#   ./scripts/backup.sh [--output-dir <dir>]
#
#   --output-dir <dir>   Where to write the archive (default: current directory)
#
# Note: run `chmod +x scripts/backup.sh` on Linux/macOS before first use.

set -Eeuo pipefail
shopt -s inherit_errexit

# ─── constants ────────────────────────────────────────────────────────────────

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"

readonly TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
readonly ARCHIVE_NAME="conductor-backup-${TIMESTAMP}.tar.gz"
readonly DB_CONTAINER="conductor-db"
readonly DB_NAME="postgres"
readonly DB_USER="postgres"

# ─── helpers ──────────────────────────────────────────────────────────────────

log_info()  { printf '[INFO]  %s\n' "$*" >&2; }
log_ok()    { printf '[OK]    %s\n' "$*" >&2; }
log_error() { printf '[ERROR] %s\n' "$*" >&2; }

die() {
  log_error "$*"
  exit 1
}

# ─── argument parsing ─────────────────────────────────────────────────────────

OUTPUT_DIR="$(pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      [[ -n "${2:-}" ]] || die "--output-dir requires an argument"
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --help|-h)
      printf 'Usage: %s [--output-dir <dir>]\n' "$(basename -- "$0")"
      exit 0
      ;;
    *)
      die "Unknown option: $1  (try --help)"
      ;;
  esac
done

readonly ARCHIVE_PATH="${OUTPUT_DIR}/${ARCHIVE_NAME}"

# ─── cleanup trap ─────────────────────────────────────────────────────────────

WORK_DIR=""

cleanup() {
  if [[ -n "${WORK_DIR}" && -d "${WORK_DIR}" ]]; then
    rm -rf -- "${WORK_DIR}"
  fi
}
trap cleanup EXIT

# ─── prepare staging directory ────────────────────────────────────────────────

prepare_staging() {
  WORK_DIR="$(mktemp -d)"
  log_info "Staging directory: ${WORK_DIR}"
}

# ─── pg_dump ──────────────────────────────────────────────────────────────────

dump_database() {
  log_info "Running pg_dump on container '${DB_CONTAINER}'..."

  mkdir -p -- "${WORK_DIR}/db"

  if ! docker inspect "${DB_CONTAINER}" &>/dev/null 2>&1; then
    die "Container '${DB_CONTAINER}' not found. Is it running? (try: docker compose up -d supabase-db)"
  fi

  docker exec "${DB_CONTAINER}" \
    pg_dump \
      --username="${DB_USER}" \
      --dbname="${DB_NAME}" \
      --no-password \
      --format=plain \
      --no-owner \
      --no-acl \
    > "${WORK_DIR}/db/conductor.sql"

  log_ok "Database dump written to db/conductor.sql"
}

# ─── .env structure (values redacted) ────────────────────────────────────────

dump_env_structure() {
  local env_file="${ROOT_DIR}/.env"
  local env_example="${ROOT_DIR}/.env.example"

  mkdir -p -- "${WORK_DIR}/env"

  local source_file=""
  if [[ -f "${env_file}" ]]; then
    source_file="${env_file}"
  elif [[ -f "${env_example}" ]]; then
    source_file="${env_example}"
    log_info "No .env found — using .env.example for structure."
  else
    log_info "Neither .env nor .env.example found — skipping env structure."
    return
  fi

  # Redact: keep KEY= lines but blank all values; preserve comments and blanks.
  while IFS= read -r line; do
    if [[ "${line}" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      local key="${line%%=*}"
      printf '%s=\n' "${key}"
    else
      printf '%s\n' "${line}"
    fi
  done < "${source_file}" > "${WORK_DIR}/env/.env.structure"

  log_ok "Env structure (values redacted) written to env/.env.structure"
}

# ─── migrations ───────────────────────────────────────────────────────────────

copy_migrations() {
  local src="${ROOT_DIR}/supabase/migrations"
  if [[ ! -d "${src}" ]]; then
    log_info "No supabase/migrations directory found — skipping."
    return
  fi

  log_info "Copying supabase/migrations/..."
  cp -r -- "${src}" "${WORK_DIR}/migrations"
  log_ok "Migrations copied ($(find "${WORK_DIR}/migrations" -name '*.sql' | wc -l | tr -d ' ') files)"
}

# ─── docs ─────────────────────────────────────────────────────────────────────

copy_docs() {
  local src="${ROOT_DIR}/docs"
  if [[ ! -d "${src}" ]]; then
    log_info "No docs/ directory found — skipping."
    return
  fi

  log_info "Copying docs/..."
  cp -r -- "${src}" "${WORK_DIR}/docs"
  log_ok "Docs copied"
}

# ─── create archive ───────────────────────────────────────────────────────────

create_archive() {
  log_info "Creating archive: ${ARCHIVE_PATH}..."

  mkdir -p -- "${OUTPUT_DIR}"

  tar --create \
      --gzip \
      --file="${ARCHIVE_PATH}" \
      --directory="${WORK_DIR}" \
      .

  local size
  size="$(du -sh -- "${ARCHIVE_PATH}" 2>/dev/null | cut -f1 || echo "unknown")"

  log_ok "Archive created"
  printf '\n'
  printf '  Location : %s\n' "${ARCHIVE_PATH}"
  printf '  Size     : %s\n' "${size}"
  printf '\n'
}

# ─── main ─────────────────────────────────────────────────────────────────────

main() {
  log_info "=== Conductor backup ==="

  prepare_staging
  dump_database
  dump_env_structure
  copy_migrations
  copy_docs
  create_archive

  log_ok "=== Backup complete ==="
}

main "$@"

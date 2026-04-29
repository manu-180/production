#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-iyrnriomswxansjuxfwi}"
OUT="packages/db/src/types.gen.ts"

echo "Generating TypeScript types from Supabase project $PROJECT_REF..."
pnpm dlx supabase gen types typescript \
  --project-id "$PROJECT_REF" \
  > "$OUT"

echo "Done — types written to $OUT"

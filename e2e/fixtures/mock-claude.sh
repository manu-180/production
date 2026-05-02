#!/usr/bin/env bash
# Mock claude binary for E2E tests.
# Streams pre-recorded JSONL fixture based on the MOCK_CLAUDE_FIXTURE env var.
# Usage: set CONDUCTOR_MOCK_CLAUDE=true so the executor picks this script up
#        instead of the real claude binary.

FIXTURE_DIR="$(dirname "$0")/claude-streams"
FIXTURE="${MOCK_CLAUDE_FIXTURE:-simple-echo}"

if [ -f "$FIXTURE_DIR/$FIXTURE.jsonl" ]; then
  while IFS= read -r line; do
    echo "$line"
    sleep 0.05  # simulate streaming delay
  done < "$FIXTURE_DIR/$FIXTURE.jsonl"
else
  echo '{"type":"result","subtype":"error","error":"Fixture not found: '"$FIXTURE"'"}'
  exit 1
fi

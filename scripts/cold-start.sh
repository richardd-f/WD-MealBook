#!/usr/bin/env bash
# Measures cold start = time from a fresh container start to the first HTTP 200.
# Container-restart cold start (php-fpm is long-running), not serverless.
#
# Usage (from repo root):
#   ./scripts/cold-start.sh [RUNS]
set -euo pipefail

COMPOSE="${COMPOSE:-docker-compose.yml}"
URL="${URL:-http://web/}"
NETWORK="${NETWORK:-npm_default}"
TIMEOUT="${TIMEOUT:-120}"
CURL_IMG="${CURL_IMG:-curlimages/curl:8.8.0}"
RUNS="${1:-1}"

total=0
count=0
for i in $(seq 1 "$RUNS"); do
  echo "[$i/$RUNS] stopping app + web..."
  docker compose -f "$COMPOSE" stop app web >/dev/null

  start=$(date +%s%3N)  # milliseconds
  docker compose -f "$COMPOSE" up -d --force-recreate app web >/dev/null

  ready=0
  while :; do
    now=$(date +%s%3N)
    elapsed_ms=$(( now - start ))
    if [ "$elapsed_ms" -ge $(( TIMEOUT * 1000 )) ]; then break; fi
    code=$(docker run --rm --network "$NETWORK" "$CURL_IMG" \
      -s -o /dev/null -w "%{http_code}" --max-time 3 "$URL" 2>/dev/null || true)
    if [ "$code" = "200" ]; then ready=1; break; fi
    sleep 0.2
  done

  if [ "$ready" = "1" ]; then
    elapsed_s=$(awk "BEGIN {printf \"%.3f\", $elapsed_ms / 1000}")
    printf "    cold start: %s s\n" "$elapsed_s"
    total=$(( total + elapsed_ms ))
    count=$((count + 1))
  else
    echo "    timed out after ${TIMEOUT}s"
  fi
done

if [ "$count" -gt 0 ]; then
  avg=$(awk "BEGIN {printf \"%.3f\", $total / $count / 1000}")
  echo ""
  echo "cold_start_seconds (avg of $count): $avg"
fi

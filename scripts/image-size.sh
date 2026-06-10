#!/usr/bin/env bash
# Reports deployment size = size of the built Docker image(s) shipped for MealBook.
#
# Usage (from repo root):
#   ./scripts/image-size.sh
set -euo pipefail

COMPOSE="${COMPOSE:-docker-compose.yml}"
SERVICES=("app" "web")

total=0
echo "Deployment image sizes:"
for svc in "${SERVICES[@]}"; do
  id=$(docker compose -f "$COMPOSE" images -q "$svc" 2>/dev/null | head -n1 || true)
  if [ -z "$id" ]; then
    echo "  $svc : no image (build it first)"
    continue
  fi
  bytes=$(docker image inspect "$id" --format '{{.Size}}')
  mb=$(awk "BEGIN {printf \"%.1f\", $bytes / 1048576}")
  total=$((total + bytes))
  printf "  %-6s %8s MB  (%s)\n" "$svc" "$mb" "${id:0:19}"
done

total_mb=$(awk "BEGIN {printf \"%.1f\", $total / 1048576}")
echo ""
echo "deployment_size_mb (total): $total_mb"

#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Local gate — API-centric deployment flows that need REAL Docker.
#
# Covers the two flows that cannot run inside CI:
#   1. PROD BOOT       — only the prod compose stack starts; the API itself
#                        spawns and supervises the managed web container.
#   2. SIDE-BY-SIDE    — dev API + dev web next to each other; the API must
#                        NOT spawn a managed web and must hide /manage/web-app.
#
# Usage:   bash scripts/local-gate-api-centric.sh
# Prereq:  docker + the repo's .env (cp .env.example .env)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_DIR="$ROOT/docker/compose"
PROJ="${COMPOSE_PROJECT_NAME:-deployer-gate}"
export COMPOSE_PROJECT_NAME="$PROJ"

PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "❌ $1"; FAIL=$((FAIL+1)); }
cleanup() {
  echo "── cleanup ──"
  docker compose -f "$COMPOSE_DIR/docker-compose.prod.yml" down -v --remove-orphans >/dev/null 2>&1 || true
  docker rm -f "$PROJ-managed-web" >/dev/null 2>&1 || true
}
trap cleanup EXIT

require() { command -v "$1" >/dev/null || { bad "missing dependency: $1"; exit 1; }; }
require docker

wait_for() { # url, timeout_s
  local url="$1" timeout="${2:-120}" start now
  start=$(date +%s)
  until curl -sf -o /dev/null "$url"; do
    now=$(date +%s); [ $((now-start)) -gt "$timeout" ] && return 1
    sleep 2
  done
}

echo "════════════════════════════════════════════════════════════"
echo " FLOW 1 — PROD BOOT: API spawns and supervises the managed web"
echo "════════════════════════════════════════════════════════════"

# The managed web image must exist locally for the supervisor to run it.
docker image inspect deployer-web:latest >/dev/null 2>&1 || {
  echo "building deployer-web:latest (once)…"
  (cd "$ROOT" && docker build -q -f docker/builder/web/Dockerfile.web.runtime.prod -t deployer-web:latest .)
}

SETUP_AUTO=true docker compose --env-file "$ROOT/.env" \
  -f "$COMPOSE_DIR/docker-compose.prod.yml" up -d api-prod

API="http://localhost:${API_PORT:-3005}"
echo "waiting for API at $API/health …"
wait_for "$API/health" 180 || { bad "API did not become healthy"; exit 1; }
ok "API healthy on $API"

echo "waiting for API-supervised managed web container …"
deadline=$(( $(date +%s) + 120 ))
while true; do
  state=$(docker inspect -f '{{.State.Running}}' "$PROJ-managed-web" 2>/dev/null || echo missing)
  [ "$state" = "true" ] && break
  [ "$(date +%s)" -gt "$deadline" ] && { bad "managed web container never ran"; exit 1; }
  sleep 3
done
ok "managed web container is running — spawned by the API, not compose"

docker ps --format '{{.Names}}' | grep -q "^deployer-traefik" \
  && ok "platform Traefik supervised by API" \
  || bad "platform Traefik container missing"

curl -s "$API/health/detailed" | grep -q '"supervisors"' \
  && ok "detailed health reports supervisors[]" \
  || bad "detailed health missing supervisors[]"

echo "toggling flag OFF via console → container must disappear"
curl -s -X POST "$API/manage/web-app/toggle" >/dev/null
deadline=$(( $(date +%s) + 60 ))
while docker inspect -f '{{.State.Running}}' "$PROJ-managed-web" 2>/dev/null | grep -q true; do
  [ "$(date +%s)" -gt "$deadline" ] && { bad "managed web still running after disable"; exit 1; }
  sleep 3
done
ok "flag off → managed web removed by the reconciler"

echo "════════════════════════════════════════════════════════════"
echo " FLOW 2 — SIDE-BY-SIDE: EXTERNAL=true hides spawn + console"
echo "════════════════════════════════════════════════════════════"

# Reuse the same running API but flip it into side-by-side mode.
docker rm -f "$PROJ-api-prod" >/dev/null
MANAGED_WEB_APP_EXTERNAL=true SETUP_AUTO=true docker compose --env-file "$ROOT/.env" \
  -f "$COMPOSE_DIR/docker-compose.prod.yml" up -d api-prod

wait_for "$API/health" 180 || { bad "API (side-by-side) not healthy"; exit 1; }

code=$(curl -s -o /dev/null -w '%{http_code}' "$API/manage/web-app")
[ "$code" = "404" ] && ok "/manage/web-app hidden in external mode (404)" \
                    || bad "/manage/web-app returned $code, expected 404"

if docker inspect "$PROJ-managed-web" >/dev/null 2>&1; then
  bad "API spawned a managed web despite EXTERNAL=true"
else
  ok "no managed web spawned in external mode"
fi

echo "════════════════════════════════════════════════════════════"
echo " RESULT: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════════════════════════"
[ "$FAIL" -eq 0 ]

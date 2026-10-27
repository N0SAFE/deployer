#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Reset the supervised microservices profile so setup serves the WIZARD again.
#
# WHAT GOES WRONG WITHOUT THIS
# `nextjs-nestjs_supervised_local_db` holds ONE `node_config` row per node, and
# it survives `docker compose down`. `SetupGateService.onApplicationBootstrap`
# reads `setup_state` and, when it is `setup_done`, logs
#
#   Setup already completed on this node — converging without the wizard
#
# and converges straight through. That is correct for a restart — but it means a
# re-run of the profile silently skips onboarding, so the wizard is never served
# and nothing looks broken (`exit 0`, all services 1/1).
#
# Three things must go, and only one of them is owned by compose:
#   1. the SWARM SERVICES — scheduled by setup, so compose has no record of them
#   2. the node volume      — the `setup_done` row itself; `down -v` handles it
#   3. the OVERLAY NETWORK  — created at runtime, also invisible to compose
#
# Usage:  bun run dev:services:supervised:reset
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJ="${COMPOSE_PROJECT_NAME:-nextjs-nestjs}"
COMPOSE="infra/docker/compose/docker-compose.services.dev-supervised.yml"

echo "── removing swarm services (scheduled by setup, unknown to compose) ──"
mapfile -t SERVICES < <(docker service ls -q)
if [ "${#SERVICES[@]}" -gt 0 ]; then
  docker service rm "${SERVICES[@]}" >/dev/null
  # `service rm` is asynchronous: a volume cannot be deleted while a task still
  # has it mounted, and `down -v` would then report `Resource is still in use`
  # yet still exit 0 — a HALF-reset that looks complete. Wait for the tasks.
  echo "   waiting for tasks to stop…"
  for _ in $(seq 60); do
    [ -z "$(docker ps -q --filter 'label=com.docker.swarm.service.id')" ] && break
    sleep 1
  done
else
  echo "   none"
fi

# The mesh agent is a PLAIN container on the host (not a swarm task), started by
# setup before the swarm exists. It holds `deployer-mesh-run`, so it must go too.
docker rm -f deployer-mesh-agent >/dev/null 2>&1 && echo "── removed the mesh agent container ──"

echo "── compose down -v (removes the container and the node volume) ──"
docker compose -f "$COMPOSE" --profile all --project-name "$PROJ" down -v --remove-orphans

echo "── removing the runtime overlay ──"
docker network rm deployer-platform-overlay >/dev/null 2>&1 && echo "   removed" || echo "   absent or in use"

# `down -v` exits 0 even when a volume is still mounted, so VERIFY instead of
# trusting the exit code. A surviving `supervised_local_db` keeps `setup_done`
# and the wizard is skipped again — the exact failure this script exists for.
echo "── verifying ──"
LEFTOVER=0
for v in "${PROJ}_supervised_local_db" deployer-mesh-run; do
  if docker volume inspect "$v" >/dev/null 2>&1; then
    docker volume rm "$v" >/dev/null 2>&1 && continue
    echo "   ⚠️  $v survived — something still mounts it:" >&2
    docker ps -a --format '{{.Names}}' | while read -r c; do
      docker inspect "$c" --format '{{range .Mounts}}{{.Name}} {{end}}' 2>/dev/null \
        | grep -q "$v" && echo "        $c" >&2
    done
    LEFTOVER=1
  fi
done

if [ "$LEFTOVER" -ne 0 ]; then
  echo >&2
  echo "❌ Reset INCOMPLETE — the next run would skip the wizard again." >&2
  echo "   Stop the container listed above, then re-run this script." >&2
  exit 1
fi

echo
echo "✅ Reset. The next \`bun run dev:services:supervised\` will serve the wizard."
echo "   Swarm membership is deliberately KEPT: setup re-converges an existing"
echo "   cluster idempotently, and leaving it would orphan the node's identity."

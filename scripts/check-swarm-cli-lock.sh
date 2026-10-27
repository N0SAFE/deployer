#!/usr/bin/env bash
# =====================================================================
# Swarm CLI-lock guard (docs/swarm-orchestration — principle 7: SDK-first,
# zero CLI orchestration). Fails when swarm paths shell out to the docker
# CLI instead of using the dockerode SDK through DockerService.
# Wired as `bun run check:swarm:cli-lock`.
# =====================================================================
set -euo pipefail

paths=(
  "apps/api-services/shared/src/core/modules/swarm"
  "packages/nest/swarm/src"
  "apps/api-services/services/runtime/src/modules/runners/swarm"
)

# A path that no longer exists must FAIL the guard: grep's errors are swallowed below, so a
# moved directory would otherwise turn this check into a silent pass over nothing.
for path in "${paths[@]}"; do
  if [ ! -d "${path}" ]; then
    echo "❌ Swarm CLI-lock: ${path} does not exist — update the paths in this script" >&2
    exit 1
  fi
done

match="$(grep -rEn 'spawn\(|execFile\(|execSync\(|child_process' "${paths[@]}" 2>/dev/null || true)"

if [ -n "${match}" ]; then
  echo "❌ Swarm CLI-lock violation — docker CLI shell-out found in swarm paths:" >&2
  echo "${match}" >&2
  exit 1
fi

echo "✅ Swarm CLI-lock OK — no spawn/exec in swarm paths"